# Visual Feedback Agent (Markup.io Clone)

An agentic visual feedback tool built for Next.js. Clients drop a `<script>` tag on their staging site, click anywhere to leave a comment, and a background AI Agent automatically generates the CSS/React fix and opens a GitHub PR.

## 🚀 Features
- **Script-Tag Injection**: Zero-config `<script>` widget that bypasses iframe CORS issues.
- **Precision Targeting**: Captures exact X/Y coordinates and generates an XPath DOM selector.
- **Agentic Actions**: "Deploy AI Agent" button queries an LLM to generate the code fix.
- **GitHub PR Automation**: Automatically branches, commits the fix, and opens a Pull Request on your target repository.

## 🛠 Tech Stack
- **Framework**: Next.js (App Router)
- **Database**: PostgreSQL (via Prisma)
- **Styling**: Tailwind CSS
- **APIs**: Maton API Gateway (GitHub, LLMs)

## 📦 Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   Create a `.env` file with:
   ```env
   DATABASE_URL="postgresql://user:pass@localhost:5432/markup_db"
   MATON_API_KEY="your-maton-api-key"
   ```

3. **Initialize Database**
   ```bash
   npx prisma db push
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```

## 🧩 How to Install the Widget
Give this snippet to your clients to place in their `<head>`:
```html
<script src="https://your-domain.com/widget.js"></script>
```
