# Scower

Full-stack Scower foundation: PostgreSQL persistence, account authentication, buyer/researcher roles, bounties, submissions, wallet association and an x402 payment boundary.

## Render
Build: `npm install`
Start: `npm start`

Environment variables:
- `DATABASE_URL` — Render PostgreSQL Internal Database URL
- `JWT_SECRET` — long random secret

The frontend is in `Public/index.html` and is served by `server.js`.

## Important
The x402 route returns a real HTTP 402 payment-required response, but blockchain settlement verification is intentionally not faked. Mainnet USDC settlement requires a payment facilitator/verifier and the exact Algorand/x402 payment flow to be configured before marking a payment settled.