#!/usr/bin/env python3
"""Consistent online backup of the Calibra SQLite DB (SQLite backup API; safe while prod is running, WAL-aware).

Usage: scripts/backup-db.py [--db data/gfi.db] [--dest /workspace/calibra-backups] [--label pre-change]
Writes <dest>/gfi-<UTCstamp>[-label].db, verifies it (PRAGMA integrity_check + per-table row counts
compared with the source at backup time), gzips a copy, and writes a .json manifest with sha256.
Exit code 0 only when the backup verified OK. Never modifies the source DB. Never commit backups.
"""
import argparse, datetime as dt, gzip, hashlib, json, os, shutil, sqlite3, sys

def counts(conn):
    tabs = [t for (t,) in conn.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
    return {t: conn.execute(f'select count(*) from "{t}"').fetchone()[0] for t in sorted(tabs)}

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()

def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(here, "data", "gfi.db"))
    ap.add_argument("--dest", default=os.environ.get("CALIBRA_BACKUP_DIR", os.path.join(os.path.dirname(here), "calibra-backups")))
    ap.add_argument("--label", default="")
    a = ap.parse_args()
    os.makedirs(a.dest, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = f"gfi-{stamp}" + (f"-{a.label}" if a.label else "")
    out = os.path.join(a.dest, name + ".db")
    src = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True, timeout=30)
    dst = sqlite3.connect(out)
    with dst:
        src.backup(dst)  # snapshot is consistent as of the end of the backup step
    src_counts = counts(src)  # read after backup; prod may have appended rows meanwhile
    dst.execute("PRAGMA journal_mode=DELETE")
    integ = dst.execute("PRAGMA integrity_check").fetchone()[0]
    dst_counts = counts(dst)
    dst.close(); src.close()
    # Backup must contain every table and no table may have MORE rows than the live source read afterwards.
    mismatch = {t: (dst_counts.get(t), n) for t, n in src_counts.items() if t not in dst_counts or dst_counts[t] > n}
    shrink = {t: (dst_counts[t], n) for t, n in src_counts.items() if t in dst_counts and dst_counts[t] < n}
    with open(out, "rb") as f, gzip.open(out + ".gz", "wb", compresslevel=6) as g: shutil.copyfileobj(f, g)
    ok = integ == "ok" and not mismatch
    man = {"backup": out, "gz": out + ".gz", "source": a.db, "created_utc": stamp, "integrity_check": integ,
           "tables": len(dst_counts), "row_counts": dst_counts, "rows_added_in_source_during_backup": shrink,
           "missing_or_excess_tables": mismatch, "sha256_db": sha256(out), "sha256_gz": sha256(out + ".gz"),
           "bytes_db": os.path.getsize(out), "verified": ok}
    json.dump(man, open(out + ".json", "w"), indent=1)
    print(json.dumps({k: man[k] for k in ("backup", "integrity_check", "tables", "verified", "sha256_db")}))
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
