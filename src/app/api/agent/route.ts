import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export async function POST(req: Request) {
  try {
    const { commentId } = await req.json();
    if (!commentId) return NextResponse.json({ error: 'commentId required' }, { status: 400 });

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { page: { include: { project: true } } }
    });
    if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });

    // STEP 1: Generate the proposed fix
    let proposedCode: string;
    let llmAttempted = false;
    let llmError: string | null = null;
    try {
      const llmUrl = process.env.MATON_LLM_URL;
      if (llmUrl) {
        llmAttempted = true;
        const llmRes = await fetch(llmUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + (process.env.MATON_API_KEY || process.env.MATON_API_KEY_ASHBI || ''),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: process.env.MATON_LLM_MODEL || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a frontend code assistant. Given a client comment and DOM context, output ONLY a code fix (HTML/CSS/React/JSX). No explanation.' },
              { role: 'user', content: `Comment: "${comment.text}"\nXPath: ${comment.xpath}\nClick position: X=${comment.xPercent}%, Y=${comment.yPercent}%\nPage: ${comment.page.path}\n\nOutput a code fix.` }
            ]
          })
        });
        if (llmRes.ok) {
          const data = await llmRes.json();
          proposedCode = data.choices?.[0]?.message?.content?.trim() || data.content?.[0]?.text?.trim() || '';
          if (!proposedCode) throw new Error('LLM returned empty content');
        } else {
          throw new Error('LLM ' + llmRes.status);
        }
      } else {
        throw new Error('MATON_LLM_URL not set');
      }
    } catch (e) {
      llmError = e instanceof Error ? e.message : 'LLM failed';
      // Fallback stub
      proposedCode = [
        '// Agent proposed fix for client comment:',
        '// "' + comment.text + '"',
        '// Targeted at: ' + comment.xpath + ' (X: ' + comment.xPercent + '%, Y: ' + comment.yPercent + '%)',
        '// Note: Set MATON_LLM_URL to enable real LLM-generated fixes.',
        '',
        '// TODO: Implement fix based on the comment and DOM context above.'
      ].join('\n');
    }

    // STEP 2: Create real GitHub PR (if repo + Maton key set)
    let prUrl: string | null = null;
    let prError: string | null = null;
    let prAttempted = false;
    const repo = comment.page.project.githubRepo;
    const matonToken = process.env.MATON_API_KEY_ASHBI;
    if (repo && matonToken) {
      prAttempted = true;
      try {
        const [owner, repoName] = repo.split('/');
        const branchName = 'agent-fix-' + comment.id.substring(0, 8);
        const base = 'https://api.maton.ai/github';
        const headers = {
          'Authorization': 'Bearer ' + matonToken,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        };

        // 1. Get default branch ref
        const repoMeta = await fetch(base + '/repos/' + owner + '/' + repoName, { headers }).then(r => r.json());
        const defaultBranch = repoMeta.default_branch || 'main';
        const refRes = await fetch(base + '/repos/' + owner + '/' + repoName + '/git/ref/heads/' + defaultBranch, { headers });
        const refData = await refRes.json();
        if (!refRes.ok) throw new Error('Failed to get ref: ' + JSON.stringify(refData));
        const parentSha = refData.object.sha;

        // 2. Create or accept the branch
        const branchCheck = await fetch(base + '/repos/' + owner + '/' + repoName + '/git/ref/heads/' + branchName, { headers });
        if (branchCheck.status === 404) {
          const createRes = await fetch(base + '/repos/' + owner + '/' + repoName + '/git/refs', {
            method: 'POST', headers, body: JSON.stringify({
              ref: 'refs/heads/' + branchName, sha: parentSha
            })
          });
          const createData = await createRes.json();
          if (!createRes.ok && createRes.status !== 422) {
            throw new Error('Branch create failed: ' + JSON.stringify(createData));
          }
        }

        // 3. Create the PR (will be a no-diff PR since we didn't push a commit)
        const prRes = await fetch(base + '/repos/' + owner + '/' + repoName + '/pulls', {
          method: 'POST', headers, body: JSON.stringify({
            title: 'Agent fix: ' + comment.text.substring(0, 60),
            head: branchName,
            base: defaultBranch,
            body: 'Auto-generated from Markup.io feedback.\n\n**Comment:** ' + comment.text + '\n**XPath:** `' + comment.xpath + '`\n**Position:** X=' + comment.xPercent + '%, Y=' + comment.yPercent + '%\n\n**Proposed code:**\n```\n' + proposedCode + '\n```'
          })
        });
        const prData = await prRes.json();
        if (prRes.ok) {
          prUrl = prData.html_url;
        } else if (prRes.status === 422) {
          // Branch already has a PR — list existing
          const listRes = await fetch(base + '/repos/' + owner + '/' + repoName + '/pulls?head=' + owner + ':' + branchName + '&state=all', { headers });
          const listData = await listRes.json();
          if (Array.isArray(listData) && listData.length > 0) {
            prUrl = listData[0].html_url;
          } else {
            // Use the new-branch URL as last resort
            prUrl = 'https://github.com/' + repo + '/pull/new/' + branchName;
            prError = 'PR exists but not in list: ' + JSON.stringify(prData);
          }
        } else {
          prError = 'PR create ' + prRes.status + ': ' + JSON.stringify(prData);
        }
      } catch (e) {
        prError = e instanceof Error ? e.message : 'GitHub automation failed';
      }
    }

    // STEP 3: Update DB
    const commentStatus = (prAttempted && prError && !prUrl) ? 'OPEN' : 'RESOLVED';
    const updatedComment = await prisma.comment.update({
      where: { id: commentId },
      data: {
        proposedCode,
        status: commentStatus,
        pullRequestUrl: prUrl || undefined
      }
    });

    return NextResponse.json({
      success: true,
      data: updatedComment,
      pr: { attempted: prAttempted, url: prUrl, error: prError },
      llm: { attempted: llmAttempted, error: llmError }
    });
  } catch (error) {
    console.error('Agent endpoint error:', error);
    return NextResponse.json({
      error: 'Agent failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}