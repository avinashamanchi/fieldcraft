#!/usr/bin/env python3
"""
FieldCraft Supabase Setup Script
---------------------------------
Creates a new Supabase project, runs the schema SQL,
and updates GitHub secrets with the project credentials.

Usage:
  python scripts/setup-supabase.py

Environment variables required:
  SUPABASE_ACCESS_TOKEN  - Your Supabase personal access token
  GITHUB_TOKEN           - GitHub personal access token with repo scope
  GITHUB_REPO            - GitHub repo in format "owner/repo" (e.g. "avinashamanchi/fieldcraft")

You can also pass them as command-line args:
  python scripts/setup-supabase.py <supabase_token> <github_token> <github_repo>
"""

import sys
import os
import json
import time
import base64
import subprocess
from pathlib import Path


SUPABASE_API = "https://api.supabase.com/v1"
GITHUB_API = "https://api.github.com"

FIELDCRAFT_SITE_URL = "https://avinashamanchi.github.io/fieldcraft"


# ─── HTTP helpers ─────────────────────────────────────────────────────────────

def http_request(url: str, method: str = "GET", data: dict | None = None,
                 headers: dict | None = None) -> dict:
    """Make an HTTP request via curl and return parsed JSON response."""
    cmd = [
        "curl", "-s", "-S",
        "-X", method,
        "-H", "Content-Type: application/json",
        "-H", "Accept: application/json",
        "-w", "\n__HTTP_STATUS__%{http_code}",
    ]
    if headers:
        for k, v in headers.items():
            cmd.extend(["-H", f"{k}: {v}"])
    if data is not None:
        cmd.extend(["-d", json.dumps(data)])
    cmd.append(url)

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    output = result.stdout

    if "\n__HTTP_STATUS__" in output:
        body, status_str = output.rsplit("\n__HTTP_STATUS__", 1)
        status_code = int(status_str.strip())
    else:
        body, status_code = output, 0

    body = body.strip()
    if not body and result.returncode != 0:
        raise RuntimeError(f"curl error: {result.stderr.strip()}")

    parsed = json.loads(body) if body else {}
    if status_code >= 400:
        raise RuntimeError(f"HTTP {status_code}: {json.dumps(parsed)}")
    return parsed


def supabase_request(path: str, method: str = "GET", data: dict | None = None,
                     token: str = "") -> dict:
    return http_request(
        f"{SUPABASE_API}{path}",
        method=method,
        data=data,
        headers={"Authorization": f"Bearer {token}"},
    )


def github_request(path: str, method: str = "GET", data: dict | None = None,
                   token: str = "") -> dict:
    return http_request(
        f"{GITHUB_API}{path}",
        method=method,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )


# ─── Supabase helpers ─────────────────────────────────────────────────────────

def get_or_create_project(token: str) -> dict:
    """Get existing fieldcraft project or create a new one."""
    print("Checking for existing FieldCraft project...")
    projects = supabase_request("/projects", token=token)
    for p in projects:
        if p.get("name") == "fieldcraft":
            print(f"  Found existing project: {p['id']}")
            return p

    print("  Creating new Supabase project 'fieldcraft'...")
    # Get list of organizations to find org ID
    orgs = supabase_request("/organizations", token=token)
    if not orgs:
        raise RuntimeError("No Supabase organizations found. Create one at supabase.com first.")
    org_id = orgs[0]["id"]
    print(f"  Using organization: {orgs[0].get('name', org_id)}")

    project = supabase_request("/projects", method="POST", token=token, data={
        "name": "fieldcraft",
        "organization_id": org_id,
        "plan": "free",
        "region": "us-east-1",
        "db_pass": generate_password(),
    })
    print(f"  Created project: {project['id']}")
    return project


def wait_for_project(project_id: str, token: str, timeout_s: int = 300) -> dict:
    """Poll until the project status is ACTIVE_HEALTHY."""
    print(f"  Waiting for project to be ready (up to {timeout_s}s)...", end="", flush=True)
    start = time.time()
    while time.time() - start < timeout_s:
        p = supabase_request(f"/projects/{project_id}", token=token)
        status = p.get("status", "")
        if status == "ACTIVE_HEALTHY":
            print(" ready!")
            return p
        print(".", end="", flush=True)
        time.sleep(10)
    raise RuntimeError(f"Project did not become ready within {timeout_s}s (last status: {status})")


def run_sql(project_id: str, token: str, sql: str) -> None:
    """Run SQL on the project database."""
    result = supabase_request(
        f"/projects/{project_id}/database/query",
        method="POST",
        token=token,
        data={"query": sql},
    )
    if isinstance(result, dict) and result.get("error"):
        raise RuntimeError(f"SQL error: {result['error']}")
    print("  Schema applied successfully.")


def get_project_api_keys(project_id: str, token: str) -> dict:
    """Return the anon and service_role API keys."""
    keys = supabase_request(f"/projects/{project_id}/api-keys", token=token)
    result = {}
    for k in keys:
        if k.get("name") == "anon":
            result["anon"] = k["api_key"]
        elif k.get("name") == "service_role":
            result["service_role"] = k["api_key"]
    return result


def configure_auth_settings(project_id: str, token: str) -> None:
    """Set site URL and redirect URLs for email auth."""
    print("  Configuring auth settings...")
    try:
        supabase_request(
            f"/projects/{project_id}/config/auth",
            method="PATCH",
            token=token,
            data={
                "site_url": FIELDCRAFT_SITE_URL,
                "uri_allow_list": [
                    FIELDCRAFT_SITE_URL,
                    FIELDCRAFT_SITE_URL + "/",
                ],
                "mailer_autoconfirm": False,
                "enable_email_signup": True,
                "enable_email_autoconfirm": False,
            },
        )
        print("  Auth settings configured.")
    except Exception as e:
        print(f"  Warning: Could not configure auth settings: {e}")


# ─── GitHub helpers ───────────────────────────────────────────────────────────

def get_repo_public_key(repo: str, token: str) -> tuple[str, str]:
    """Returns (key_id, base64_public_key) for secrets encryption."""
    data = github_request(f"/repos/{repo}/actions/secrets/public-key", token=token)
    return data["key_id"], data["key"]


def encrypt_secret(public_key_b64: str, secret_value: str) -> str:
    """Encrypt a secret value using the repo's public key (NaCl sealed box)."""
    from nacl.public import PublicKey, SealedBox
    pk = PublicKey(base64.b64decode(public_key_b64))
    box = SealedBox(pk)
    encrypted = box.encrypt(secret_value.encode("utf-8"))
    return base64.b64encode(encrypted).decode("utf-8")


def set_github_secret(repo: str, secret_name: str, secret_value: str, token: str) -> None:
    """Create or update a GitHub Actions secret."""
    key_id, public_key = get_repo_public_key(repo, token)
    encrypted = encrypt_secret(public_key, secret_value)
    github_request(
        f"/repos/{repo}/actions/secrets/{secret_name}",
        method="PUT",
        token=token,
        data={"encrypted_value": encrypted, "key_id": key_id},
    )
    print(f"  Secret '{secret_name}' set on GitHub.")


def generate_password(length: int = 24) -> str:
    import secrets
    import string
    alphabet = string.ascii_letters + string.digits + "!@#$"
    return "".join(secrets.choice(alphabet) for _ in range(length))


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    # Get tokens from args or environment
    args = sys.argv[1:]
    supabase_token = args[0] if len(args) > 0 else os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    github_token = args[1] if len(args) > 1 else os.environ.get("GITHUB_TOKEN", "")
    github_repo = args[2] if len(args) > 2 else os.environ.get("GITHUB_REPO", "avinashamanchi/fieldcraft")

    if not supabase_token:
        print("ERROR: Supabase access token required.")
        print("  Get it from: https://supabase.com/dashboard/account/tokens")
        print("  Usage: python scripts/setup-supabase.py <supabase_token>")
        sys.exit(1)

    print("=" * 55)
    print("  FieldCraft × Supabase Setup")
    print("=" * 55)

    # 1. Create or find project
    project = get_or_create_project(supabase_token)
    project_id = project["id"]

    # 2. Wait for it to be healthy
    if project.get("status") != "ACTIVE_HEALTHY":
        project = wait_for_project(project_id, supabase_token)

    project_url = f"https://{project_id}.supabase.co"
    print(f"\nProject URL: {project_url}")

    # 3. Run schema SQL
    print("\nApplying database schema...")
    schema_path = Path(__file__).parent.parent / "supabase" / "schema.sql"
    schema_sql = schema_path.read_text()
    run_sql(project_id, supabase_token, schema_sql)

    # 4. Configure auth settings
    print("\nConfiguring auth...")
    configure_auth_settings(project_id, supabase_token)

    # 5. Get API keys
    print("\nFetching API keys...")
    keys = get_project_api_keys(project_id, supabase_token)
    anon_key = keys.get("anon", "")
    if not anon_key:
        raise RuntimeError("Could not retrieve anon key. Check project status.")
    print(f"  Anon key retrieved: {anon_key[:20]}...")

    # 6. Update GitHub secrets
    if github_token:
        print("\nUpdating GitHub secrets...")
        try:
            set_github_secret(github_repo, "VITE_SUPABASE_URL", project_url, github_token)
            set_github_secret(github_repo, "VITE_SUPABASE_ANON_KEY", anon_key, github_token)
        except Exception as e:
            print(f"  Warning: Could not set GitHub secrets: {e}")
            print("  Set them manually in GitHub repo settings → Secrets → Actions")

    # 7. Update local .env
    env_path = Path(__file__).parent.parent / ".env"
    env_content = env_path.read_text() if env_path.exists() else ""
    lines = env_content.splitlines()
    new_lines = []
    url_set = key_set = False
    for line in lines:
        if line.startswith("VITE_SUPABASE_URL="):
            new_lines.append(f"VITE_SUPABASE_URL={project_url}")
            url_set = True
        elif line.startswith("VITE_SUPABASE_ANON_KEY="):
            new_lines.append(f"VITE_SUPABASE_ANON_KEY={anon_key}")
            key_set = True
        else:
            new_lines.append(line)
    if not url_set:
        new_lines.append(f"VITE_SUPABASE_URL={project_url}")
    if not key_set:
        new_lines.append(f"VITE_SUPABASE_ANON_KEY={anon_key}")
    env_path.write_text("\n".join(new_lines) + "\n")
    print(f"\nUpdated .env with Supabase credentials.")

    print("\n" + "=" * 55)
    print("  Setup complete!")
    print("=" * 55)
    print(f"\n  Supabase URL:   {project_url}")
    print(f"  Anon key:       {anon_key[:20]}...")
    print(f"\n  Next steps:")
    print("  1. Run: npm run build   (to test locally)")
    print("  2. Run: git push origin main   (triggers deploy)")
    print(f"  3. Visit: {FIELDCRAFT_SITE_URL}")
    print()


if __name__ == "__main__":
    main()
