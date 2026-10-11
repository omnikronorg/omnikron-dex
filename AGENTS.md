# AGENTS.md — omnikron-dex (monorepo)

Guidance for AI coding agents working in this repository. This is a 
multi-project monorepo. The `AGENTS.md` closest to the files you are editing
wins — always read the project-level file before working inside it.

## Repository layout

- `contracts/` — Foundry smart contracts for the Omnikron DEX (factory, router,
  tokens, core/periphery libraries). See `contracts/` before touching Solidity.
- `dex-web/` — Next.js (App Router) front-end where users swap assets from their
  own wallets. **Read `dex-web/AGENTS.md` before writing any front-end code** —
  it holds the framework conventions and an auto-generated docs rule.

## How all the projects relate

- Deployed contract addresses/ABIs are recorded per chain in
  `contracts/deployments/<chainId>.json` (e.g. `1`, `56`, `97`, `137`, `31337`).
- The front-end reads addresses from these deployment files. When a contract is
  redeployed, its deployment JSON must be updated and the front-end pointed at
  the new address. Never hard-code addresses in `dex-web/` that already live in
  `contracts/deployments/`.

## Commands

### contracts/ (Foundry) — run from the `contracts/` directory
- Build: `forge build`
- Test: `forge test`
- Format: `forge fmt`
- Deploy scripts live in `contracts/script/*.s.sol`; run with
  `forge script script/<Name>.s.sol --rpc-url <network> --broadcast`.
- Networks are defined in `contracts/foundry.toml` (`[rpc_endpoints]`).

### dex-web/ (Next.js) — run from the `dex-web/` directory
- Install: `npm install`
- Dev server: `npm run dev`
- Production build: `npm run build`
- Start: `npm start`
- Lint: `npm run lint`

## Cross-cutting rules (apply repo-wide)

- **Secrets:** never print, log, or commit API keys, RPC URLs, or private keys.
  Only `.env.example` files are committed (see the root `.gitignore`).
- **Config files:** do not modify global config (`foundry.toml`, `tsconfig.json`,
  `package.json`, the root `.gitignore`, `.gitmodules`) without explicit permission.
- **Generated files:** never edit build output (`contracts/out/`, `contracts/cache/`,
  `dex-web/.next/`, `dex-web/out/`, `dex-web/dist/`).
- **Submodules:** `contracts/lib/*` and `contracts/lib/openzeppelin-contracts` are
  git submodules — do not edit vendored files; update via the submodule's remote.
- **Approvals:** ask before changing public API signatures, adding a production
  dependency, or running release/publish/migration commands.

## Git & ignore conventions

- A single centralized `.gitignore` at the repo root covers all projects
  (Foundry artifacts under `contracts/`, Node/Next artifacts under `dex-web/`).
  Add new ignore rules there, scoped with the correct `contracts/` or `dex-web/`
  prefix — do not reintroduce per-project `.gitignore` files.
