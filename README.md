# Voice Dev

Voice-controlled development environment powered by LiveKit and OpenAI Realtime API.

## Packages

- **`@voice-dev/agent`** - LiveKit agent with OpenAI Realtime API
  - Located in `packages/agent/`
  - Handles voice conversations via LiveKit
  - Integrates OpenAI Realtime API
  - Manages agent lifecycle

- **`@voice-dev/mcp-server`** - MCP server for terminal control
  - Located in `packages/mcp-server/`
  - Provides terminal session management via MCP protocol
  - Can run as HTTP server or stdio mode

- **`@voice-dev/web`** - Next.js web interface
  - Located in `packages/web/`
  - Voice interaction via LiveKit Cloud
  - Password authentication
  - Agent activity transparency (debug panel)
  - Real-time status display

## Quick Start

For detailed setup instructions, see [QUICKSTART.md](./QUICKSTART.md).

**You need TWO terminals:**

```bash
# Terminal 1: Start the LiveKit agent
npm run dev:agent

# Terminal 2: Start the web app
npm run dev
```

Then open http://localhost:3000 and click "Start Voice Chat".

For more info:
- [QUICKSTART.md](./QUICKSTART.md) - Step-by-step setup guide
- [MIGRATION.md](./MIGRATION.md) - Details about LiveKit migration

### Other Commands

```bash
# Install all dependencies
npm install

# Run MCP server in dev mode
npm run dev:mcp

# Build everything
npm run build

# Type check all packages
npm run typecheck
```

## Development

### LiveKit Agent

```bash
# Development
npm run dev:agent        # Start agent in dev mode

# Production
npm run build:agent      # Build TypeScript
npm run start:agent      # Run built agent
```

### Web App

```bash
# Development
npm run dev              # Start Next.js dev server (port 3000)

# Production
npm run build:web        # Build for production
npm run start            # Start production server
```

### MCP Server

```bash
# Development
npm run dev:mcp          # Start with HTTP server and dev-password

# Production
npm run build:mcp        # Build TypeScript
npm run start:mcp        # Run built server
```

## Environment Variables

Create `.env.local` in both `packages/web/` and `packages/agent/`:

```bash
# OpenAI
OPENAI_API_KEY=sk-your-api-key-here

# LiveKit Cloud
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Optional
AUTH_PASSWORD=your-secure-password-here      # For web auth
MCP_SERVER_URL=https://your-mcp-server-url   # For MCP integration
```

See `packages/web/.env.local.example` for template.

## Project Structure

```
voice-dev/
├── packages/
│   ├── agent/                   # LiveKit Agent Package
│   │   ├── src/
│   │   │   └── agent.ts         # Agent implementation
│   │   ├── dist/                # Compiled output
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── mcp-server/              # MCP Server Package
│   │   ├── src/
│   │   │   ├── index.ts         # CLI entry point
│   │   │   ├── http-server.ts   # HTTP server mode
│   │   │   └── tmux.ts          # Terminal operations
│   │   ├── build/               # Compiled output
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                     # Web App Package
│       ├── app/
│       │   ├── api/             # API routes (token generation)
│       │   ├── components/      # React components
│       │   ├── hooks/           # Custom hooks (LiveKit)
│       │   ├── types/           # TypeScript types
│       │   └── voice-client.tsx # Main voice UI
│       ├── package.json
│       └── next.config.js
│
├── package.json                 # Root workspace config
├── tsconfig.base.json          # Shared TypeScript config
├── README.md                   # This file
├── QUICKSTART.md               # Setup guide
└── MIGRATION.md                # LiveKit migration details
```

## Features

### LiveKit Agent
- OpenAI Realtime API integration
- Voice-to-voice conversation
- Low-latency audio processing
- Automatic room management
- System prompt customization
- Tool/function calling support

### Web App
- Real-time voice interaction via LiveKit
- LiveKit React SDK components
- Live audio level visualization
- Device selection
- Mute/unmute controls
- Password authentication
- Agent activity transparency (debug log panel)
- Real-time agent status display
- Automatic reconnection

### MCP Server
- Full terminal session control
- List sessions, windows, and panes
- Send keystrokes and text
- Create and kill sessions/windows/panes
- Capture pane output
- HTTP server mode with password auth
- stdio mode for Claude Desktop integration

## Deployment

### Web App (Vercel)

Deploy from the web package directory:

```bash
# Deploy to Vercel
cd ~/dev/voice-dev/packages/web
vercel --prod

# Set environment variables
vercel env add OPENAI_API_KEY production
vercel env add AUTH_PASSWORD production
vercel env add MCP_SERVER_URL production
```

### MCP Server

The MCP server typically runs locally:

```bash
# Build and run
npm run build:mcp
npm run start:mcp -- --http --password your-password
```

## Scripts Reference

### Root Level

| Script | Description |
|--------|-------------|
| `npm run dev` | Start web app dev server |
| `npm run dev:agent` | Start LiveKit agent dev server |
| `npm run dev:mcp` | Start MCP server dev server |
| `npm run build` | Build all packages |
| `npm run build:agent` | Build agent only |
| `npm run build:mcp` | Build MCP server only |
| `npm run build:web` | Build web app only |
| `npm run typecheck` | Type check all packages |
| `npm run start` | Start web app production server |
| `npm run start:agent` | Start agent production |
| `npm run start:mcp` | Start MCP server production |

### Package Level

Run commands in specific packages:

```bash
# Run command in web package
npm run <script> --workspace=web

# Run command in mcp-server package
npm run <script> --workspace=mcp-server
```

## Tech Stack

- **Architecture**: npm workspaces
- **Web**: Next.js 15, React 19, TypeScript, Tailwind CSS, LiveKit React SDK
- **Agent**: LiveKit Agents Framework, OpenAI Realtime API, TypeScript
- **MCP Server**: TypeScript, Express, MCP SDK
- **Voice**: LiveKit Cloud, OpenAI Realtime API, WebRTC
- **Build**: TypeScript compiler, Next.js build

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser   │◄───────►│ LiveKit Cloud│◄───────►│    Agent    │
│  (React UI) │  WebRTC │   (Server)   │  WebRTC │  (Node.js)  │
└─────────────┘         └──────────────┘         └─────────────┘
                                                          │
                                                          ▼
                                                  ┌─────────────┐
                                                  │   OpenAI    │
                                                  │ Realtime API│
                                                  └─────────────┘
```

## License

MIT
