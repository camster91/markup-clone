# Visual Feedback Agent (Markup.io Clone)

An agentic visual feedback tool for Next.js applications. Clients add a simple `<script>` tag to their staging site, click anywhere to leave feedback, and an AI Agent automatically generates CSS/React fixes and opens GitHub Pull Requests.

## Features

### Client-Side Widget
- **Script-Tag Injection:** Zero-configuration widget that bypasses iframe CORS issues
- **Precision Targeting:** Captures exact X/Y coordinates and generates XPath DOM selectors
- **Visual Annotation:** Overlay feedback markers directly on page elements
- **Screenshot Capture:** Automatic screenshots of the annotated area

### AI-Powered Code Fixes
- **Agentic Actions:** "Deploy AI Agent" button queries an LLM to generate code fixes
- **Context-Aware:** Analyzes surrounding DOM structure and existing styles
- **Framework Support:** Generates React/Next.js component fixes

### GitHub Integration
- **Automated Branching:** Creates feature branches automatically
- **Smart Commits:** Commits generated fixes with descriptive messages
- **Pull Request Creation:** Opens PRs with change summaries for review

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router) |
| Database | PostgreSQL (via Prisma) |
| Styling | Tailwind CSS |
| Icons | Heroicons |
| API Gateway | Maton API (GitHub, LLMs) |

## Prerequisites

- Node.js 18+
- PostgreSQL database
- GitHub OAuth App credentials
- Maton API key (for LLM and GitHub integration)

## Installation

```bash
# Clone the repository
git clone https://github.com/camster91/markup-clone.git
cd markup-clone

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
```

### Environment Variables

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/markup_db"

# API Keys
MATON_API_KEY="your-maton-api-key"

# GitHub OAuth (optional)
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
```

### Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# (Optional) View database
npx prisma studio
```

## Usage

### Development

```bash
# Start development server
npm run dev
```

Visit `http://localhost:3000` to view the application.

### Production Build

```bash
# Build for production
npm run build

# Start production server
npm run start
```

## Widget Integration

Give this snippet to your clients to place in their `<head>` tag:

```html
<script src="https://your-domain.com/widget.js"></script>
```

Once loaded, users can:
1. Click anywhere on the page to add a feedback marker
2. Enter their feedback in the popup
3. Click "Deploy AI Agent" to generate a fix
4. Review the generated Pull Request

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
├── components/             # React components
│   ├── Widget/            # Client-side widget components
│   ├── Dashboard/         # Admin dashboard components
│   └── Feedback/          # Feedback display components
└── lib/                    # Utility functions
    ├── prisma.ts          # Prisma client
    ├── github.ts          # GitHub API utilities
    └── llm.ts             # LLM integration

prisma/
└── schema.prisma          # Database schema

public/
└── widget.js              # Distributed widget script
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/feedback` | Create new feedback item |
| GET | `/api/feedback/:id` | Get feedback details |
| POST | `/api/generate-fix` | Trigger AI fix generation |
| POST | `/api/pr` | Create GitHub pull request |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License

---
Developed by Cameron Ashley.
