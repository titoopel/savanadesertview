SAVANA ADMIN — GitHub/Cloudflare deployment package

Unzip this ZIP in the ROOT of:
titoopel/savanadesertview

It will:
- replace admin.html
- add worker-admin/src/index.js
- add worker-admin/package.json
- add worker-admin/wrangler.jsonc

Then commit and push to main.

Cloudflare existing Worker:
savana-welcome-admin

Connect it at:
Settings > Builds > Connect

Repository:
titoopel/savanadesertview

Root directory:
worker-admin

Deploy command:
npx wrangler deploy

The existing Cloudflare secrets ADMIN_PIN and GITHUB_TOKEN are preserved.
