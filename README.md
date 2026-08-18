# Scower

Scower is a full-stack human intelligence marketplace.

## Current architecture
- Express + PostgreSQL backend
- Real password hashing and JWT authentication
- Buyer/researcher roles
- Bounties and submissions persisted in PostgreSQL
- Wallet address association
- Acceptance creates a pending payment record
- x402 endpoint scaffold returning HTTP 402 payment requirements

## Render
Build command: `npm install`
Start command: `npm start`
Environment variables:
- `DATABASE_URL` = Render internal PostgreSQL URL
- `JWT_SECRET` = long random secret
- `X402_NETWORK` = `algorand-testnet` while testing
- `X402_PAY_TO` = payment receiver address when configured

## Important
The `/api/x402/research/:id` route intentionally does not fake a successful settlement. GoPlausible facilitator integration and Mainnet USDC settlement must be configured before real money is accepted.
