#!/usr/bin/env python3
"""Fail-closed tombstone for the retired remote provisioning script.

FieldCraft's database is defined only by the ordered files under
``supabase/migrations``. This script deliberately performs no network requests,
project creation, SQL execution, secret updates, or deployment triggers.
"""

from __future__ import annotations

import sys


def main() -> int:
    print(
        "LEGACY_SETUP_DISABLED: remote provisioning from supabase/schema.sql is "
        "retired. Review and deploy the ordered supabase/migrations with an "
        "explicit, migration-aware release process.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
