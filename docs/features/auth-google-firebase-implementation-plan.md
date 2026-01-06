# Auth (Google via Firebase) – Implementation Plan

## Goal
Switch the backend “Google login” feature to accept **Firebase ID tokens** (issued by Firebase Auth) instead of **Google OIDC ID tokens**, because the mobile clients already use Firebase.

Keep the backend as the system-of-record for API sessions by minting the existing **backend access/refresh tokens** (`AuthTokensService`), while using Firebase only for identity proof at login/connect time.

## Key Decisions

### 1) “Firebase provider” meaning (and why we should enforce it)
Firebase Auth supports multiple sign-in methods (“providers”), e.g.:
- `google.com` (Google Sign-In)
- `password` (email/password)
- `apple.com`, `phone`, etc.

Firebase ID tokens include a `firebase.sign_in_provider` claim. Since our endpoint is `/v1/auth/google`, the backend should **require** `firebase.sign_in_provider === "google.com"` so clients cannot pass a non-Google Firebase token (e.g., password provider token) to the Google endpoint.

### 2) Token verification method (recommended)
Use **JWKS verification** (no Firebase Admin SDK) unless you explicitly need “instant” revocation/disable semantics.
- JWKS approach: verify signature + `iss` + `aud` using public keys and standard JWT checks.
- Admin SDK approach: can check revoked tokens/user disabled, but requires service-account credentials and adds operational burden.

Recommended default for this repo: **JWKS verification**, because:
- no service-account secrets to manage
- aligns with current stack (`jose`)
- backend issues its own access/refresh tokens anyway

If you later need stronger revocation semantics, add an optional Admin check (or implement your own server-side session revocation/denylist).

## Current State in Repo (to be refactored)
- Endpoints already exist:
  - `POST /v1/auth/google` – verifies token, creates/links user, returns `{ data: { tokens, user } }`
  - `POST /v1/auth/google/connect` – bearer-protected, links Google to current user, returns `204`
- Current verification uses Google OIDC JWKS + audience list:
  - `src/auth-google/google-oidc.service.ts`
  - env: `GOOGLE_OIDC_CLIENT_IDS`
- Persistence uses `AuthProviderAccount`:
  - `prisma/schema.prisma` + migration `20260104062706_add_auth_provider_accounts`

## Proposed Target Behavior

### Authenticate (register/login)
`POST /v1/auth/google`
- Input: `{ idToken: string }` where `idToken` is a **Firebase ID token** from Firebase Auth.
- Verify token:
  - Signature: Firebase Secure Token keys (JWKS)
  - `aud` must equal Firebase project id
  - `iss` must equal `https://securetoken.google.com/<projectId>`
  - Require `firebase.sign_in_provider === "google.com"`
  - Require `email` present and `email_verified === true`
- Account logic:
  1) If an `AuthProviderAccount` link exists for provider `GOOGLE` and `providerAccountId` (Firebase `sub`/UID), log in that user.
  2) Else, find user by normalized email:
     - If user exists: create provider link to that user.
     - If not: create user with `emailVerified=true` and provider link.
- Return: `200` `{ data: { tokens, user } }` (standard session response).

### Connect Google to existing password user
`POST /v1/auth/google/connect`
- Auth: Bearer (existing `JwtAuthGuard`)
- Input: `{ idToken: string }` (Firebase ID token)
- Verify token (same rules)
- Require Firebase email matches the current user’s email (normalized)
- Link provider account to user (upsert)
- Return: `204`

## Error Model (keep consistent with repo)
- Invalid/expired Firebase token: `401` `UNAUTHORIZED`
- Missing email / malformed claims: `400` `VALIDATION_FAILED`
- `email_verified !== true`: `403` `EMAIL_NOT_VERIFIED`
- `firebase.sign_in_provider !== "google.com"`: `403` `FORBIDDEN` (or `401`; pick one and document)
- Connect email mismatch: `403` `FORBIDDEN`
- Provider already linked to another user: `403` `FORBIDDEN` (preferred to avoid account enumeration); optionally `409` if you want explicit conflict semantics
- Misconfiguration (missing `FIREBASE_PROJECT_ID`): `500` `INTERNAL`

Update `docs/standards/error-codes.md` and OpenAPI `x-error-codes` accordingly if any codes change.

## Data Model Notes
Keep using `AuthProviderAccount` with:
- `provider = GOOGLE`
- `providerAccountId = Firebase UID (sub)`

This is fine for a single Firebase project. If you anticipate migrating away from Firebase later (or supporting multiple projects), consider adding:
- `providerTenant` / `projectId` column, or
- a separate `AuthProvider` value like `FIREBASE_GOOGLE` to make the source explicit.

## Environment / Configuration
Add:
- `FIREBASE_PROJECT_ID` (required in non-test envs when Google login is enabled)

Remove or deprecate:
- `GOOGLE_OIDC_CLIENT_IDS`

Update:
- `src/config/env.validation.ts`
- `.env.example` and `env.example`

## Implementation Steps (surgical)

1) **Add Firebase config**
   - Add `FIREBASE_PROJECT_ID` to env validation and example env files.
   - Decide if it is required always in prod, or only when Google login feature is enabled (feature flag).

2) **Implement Firebase ID token verifier (JWKS)**
   - Create `src/auth-google/firebase-auth.service.ts` (or rename existing OIDC service).
   - Use `createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"))`
   - Call `jwtVerify(token, jwks, { issuer: "https://securetoken.google.com/<projectId>", audience: "<projectId>" })`
   - Extract:
     - `sub` (Firebase UID)
     - `email`
     - `email_verified`
     - `firebase.sign_in_provider`

3) **Refactor `AuthGoogleService`**
   - Replace dependency on `GoogleOidcService` with the Firebase verifier.
   - Enforce `sign_in_provider === "google.com"`.
   - Keep user creation/linking logic intact.

4) **Update docs**
   - OpenAPI: change descriptions from “Google ID token (OIDC)” to “Firebase ID token (Google provider)”.
   - Ensure `x-error-codes` reflect chosen semantics.

5) **Update tests**
   - Replace e2e provider override from `GoogleOidcService` to the new Firebase verifier.
   - Add/adjust tests for:
     - register/login via firebase token creates user
     - connect succeeds when email matches
     - connect fails when provider mismatch / email mismatch

6) **Run validations**
   - `npm run lint`
   - `npm run test`
   - `npm run test:e2e`
   - `npm run spec:lint`

## Mobile Integration Notes (for client team)
- Mobile obtains Firebase ID token after Google sign-in:
  - e.g., `FirebaseAuth.currentUser.getIdToken()`
- Call backend:
  - `POST /v1/auth/google` with `{ idToken }` to get backend session tokens.
- For connect:
  - user logs in with password first, then call `POST /v1/auth/google/connect` with Bearer access token and `{ idToken }`.

## Rollout / Migration Risk
If this backend has already stored Google OIDC `sub` values in `AuthProviderAccount.providerAccountId`, switching to Firebase UID will break existing Google logins.

Mitigations:
- If still pre-production: wipe the provider links table (or migrate data) and proceed.
- If in production: implement a dual-acceptance period:
  - attempt lookup by Firebase UID first
  - if not found, attempt lookup by Google OIDC `sub` (old path) and backfill Firebase link
  - deprecate old path after migration window

