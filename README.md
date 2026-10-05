# Nilesh Finance Analyst

Static React frontend for GitHub Pages, with Supabase email/password authentication, per-user RLS, planning data and dated monthly transaction reports. No personal financial values are embedded in the public source.

## Setup

1. Create a website user in Supabase Authentication → Users → Add user (email/password, auto-confirm). Do not reuse your database password.
2. Run `npm ci`, then `npm run build`.
3. Enable GitHub Pages from GitHub Actions in repository Settings → Pages. The deployment workflow publishes `dist`.
4. Sign in and enter dated records in Monthly Records. Planning values are separate estimates.

The original site's saved state has been staged in a private Supabase schema. After the owner's website login is created, transfer it to finance_state with that user's UUID; do not publish the staged values in GitHub.

The publishable Supabase key is intentionally public. Database access requires authentication and owner-matching policies. Never add secret/service-role keys.
