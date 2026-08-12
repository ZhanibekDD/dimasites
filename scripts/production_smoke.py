#!/usr/bin/env python3
"""Real production-source smoke tests used by the Timeweb deploy gate."""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request


DEFAULT_FNS_INN = "8906000438"
DEFAULT_EGRZ_NUMBER = "77-1-1-2-012149-2025"
DEFAULT_EIS_NUMBER = "0372200102526000003"


class SmokeFailure(RuntimeError):
    pass


def decode_json(raw, label):
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        preview = raw[:160].decode("utf-8", errors="replace").replace("\n", " ")
        raise SmokeFailure("non-JSON response from %s: %r" % (label, preview))
    if not isinstance(body, dict):
        raise SmokeFailure("unexpected JSON type from %s" % label)
    return body


def request_json(url, payload, timeout):
    headers = {
        "Accept": "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "DNEPR-Release-Gate/1.0",
    }
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=UTF-8"
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = int(response.getcode())
            raw = response.read(2000000)
    except urllib.error.HTTPError as exc:
        status = int(exc.code)
        raw = exc.read(2000000)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SmokeFailure("transport error for %s: %s" % (url, exc))
    return status, decode_json(raw, url)


def request_php_json(document_root, php_bin, endpoint, payload, timeout):
    path = os.path.join(document_root, endpoint.lstrip("/"))
    if not os.path.isfile(path):
        raise SmokeFailure("gateway file is missing: %s" % path)
    environment = os.environ.copy()
    environment["REQUEST_METHOD"] = "GET" if payload is None else "POST"
    environment["REMOTE_ADDR"] = "127.0.0.1"
    environment["DOCUMENT_ROOT"] = document_root
    if payload is not None:
        environment["DNEPR_SOURCE_TEST_INPUT"] = json.dumps(payload, ensure_ascii=False)
    try:
        completed = subprocess.run(
            [php_bin, path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SmokeFailure("PHP gateway transport error for %s: %s" % (endpoint, exc))
    if completed.returncode != 0:
        error = completed.stderr[:300].decode("utf-8", errors="replace").replace("\n", " ")
        raise SmokeFailure("PHP gateway %s exited %s: %s" % (endpoint, completed.returncode, error))
    body = decode_json(completed.stdout, endpoint)
    return (200 if body.get("ok") is True else 502), body


class GatewayClient(object):
    def __init__(self, base_url="", document_root="", php_bin="php"):
        self.base_url = base_url.rstrip("/")
        self.document_root = document_root
        self.php_bin = php_bin

    def request(self, endpoint, payload, timeout):
        if self.document_root:
            return request_php_json(self.document_root, self.php_bin, endpoint, payload, timeout)
        return request_json(self.base_url + endpoint, payload, timeout)

    def label(self, endpoint):
        return endpoint if self.document_root else self.base_url + endpoint


def retry_json(client, endpoint, payload, timeout, attempts):
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            status, body = client.request(endpoint, payload, timeout)
            if status < 500:
                return status, body
            technical = body.get("technical", {})
            last_error = SmokeFailure(
                "HTTP %s, code=%s, diagnostic=%s, message=%s, technical=%s"
                % (
                    status,
                    body.get("code", ""),
                    body.get("diagnosticId", ""),
                    body.get("message", ""),
                    json.dumps(technical, ensure_ascii=False, sort_keys=True),
                )
            )
        except SmokeFailure as exc:
            last_error = exc
        if attempt < attempts:
            time.sleep(3)
    raise SmokeFailure(
        "%s failed after %s attempts: %s" % (client.label(endpoint), attempts, last_error)
    )


def find_fns_inn(body, expected_inn):
    for company in body.get("companies", []):
        if isinstance(company, dict) and str(company.get("inn", "")).strip() == expected_inn:
            return True
    for section in body.get("responseSections", []):
        if not isinstance(section, dict):
            continue
        for record in section.get("records", []):
            if not isinstance(record, dict):
                continue
            values = {
                str(value).strip()
                for value in record.values()
                if not isinstance(value, (dict, list))
            }
            if expected_inn in values:
                return True
    return False


def check_fns(client, inn, timeout, attempts):
    status, body = retry_json(client, "/api/fns-company.php", {"query": inn}, timeout, attempts)
    if status != 200 or body.get("ok") is not True or body.get("found") is not True:
        raise SmokeFailure(
            "FNS failed: HTTP %s, code=%s, diagnostic=%s"
            % (status, body.get("code", ""), body.get("diagnosticId", ""))
        )
    if not find_fns_inn(body, inn):
        raise SmokeFailure("FNS response did not contain the requested INN")
    source = body.get("source", {})
    print("PASS FNS: INN %s, source=%s" % (inn, source.get("name", "unknown")))
    return {
        "source": "fns",
        "query": inn,
        "found": True,
        "result_count": len(body.get("companies", [])),
        "provider": source.get("name", "unknown"),
        "diagnostic_id": body.get("diagnosticId", ""),
    }


def check_registry(client, source, query, timeout, attempts, expected_number=None):
    status, body = retry_json(
        client, "/api/source-search.php", {"source": source, "query": query}, timeout, attempts
    )
    if status != 200 or body.get("ok") is not True or body.get("found") is not True:
        raise SmokeFailure(
            "%s failed: HTTP %s, code=%s, diagnostic=%s, found=%r"
            % (
                source.upper(),
                status,
                body.get("code", ""),
                body.get("diagnosticId", ""),
                body.get("found"),
            )
        )
    results = body.get("results", [])
    if not isinstance(results, list) or not results:
        raise SmokeFailure("%s returned found=true without result records" % source.upper())
    if expected_number is not None:
        numbers = {
            str(item.get("number", "")).strip()
            for item in results
            if isinstance(item, dict)
        }
        if expected_number not in numbers:
            raise SmokeFailure(
                "%s did not return control record %s; got %r"
                % (source.upper(), expected_number, sorted(numbers))
            )
    print("PASS %s: %s verified result(s)" % (source.upper(), len(results)))
    return {
        "source": source,
        "query": query,
        "found": True,
        "result_count": len(results),
        "diagnostic_id": body.get("diagnosticId", ""),
    }


def check_release(client, expected_version, timeout):
    status, body = client.request("/api/release.php", None, timeout)
    actual = str(body.get("version", "")).strip()
    if status != 200 or body.get("ok") is not True or actual != expected_version:
        raise SmokeFailure(
            "release mismatch: expected %s, got %s" % (expected_version, actual or "<empty>")
        )
    print("PASS RELEASE: %s" % actual)
    return {"source": "release", "version": actual}


def execute_check(name, callback, args):
    started = time.time()
    try:
        details = callback(*args)
        return {
            "name": name,
            "status": "pass",
            "duration_ms": int(round((time.time() - started) * 1000)),
            "details": details,
        }
    except SmokeFailure as exc:
        message = str(exc)
        print("FAIL %s: %s" % (name, message), file=sys.stderr)
        return {
            "name": name,
            "status": "fail",
            "duration_ms": int(round((time.time() - started) * 1000)),
            "error": message,
        }


def write_report(path, report):
    if not path:
        return
    directory = os.path.dirname(os.path.abspath(path))
    if directory and not os.path.isdir(directory):
        os.makedirs(directory)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser()
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--base-url")
    target.add_argument("--document-root")
    parser.add_argument("--php-bin", default="php")
    parser.add_argument("--expected-version", default="")
    parser.add_argument("--fns-inn", default=DEFAULT_FNS_INN)
    parser.add_argument("--egrz-number", default=DEFAULT_EGRZ_NUMBER)
    parser.add_argument("--eis-number", default=DEFAULT_EIS_NUMBER)
    parser.add_argument("--timeout", type=int, default=70)
    parser.add_argument("--attempts", type=int, default=2)
    parser.add_argument("--release-only", action="store_true")
    parser.add_argument("--report-json", default="")
    parser.add_argument(
        "--optional-source",
        action="append",
        default=[],
        help="Source that remains visible in the report but does not block deployment",
    )
    args = parser.parse_args()

    client = GatewayClient(args.base_url or "", args.document_root or "", args.php_bin)
    checks = []
    if args.expected_version:
        checks.append(
            ("RELEASE", check_release, (client, args.expected_version, min(args.timeout, 30)))
        )
    if not args.release_only:
        # Every source is checked independently. A broken EGRZ adapter must never
        # hide the actual FNS or EIS state from the deployment report.
        checks.extend(
            [
                ("FNS", check_fns, (client, args.fns_inn, args.timeout, args.attempts)),
                (
                    "EGRZ",
                    check_registry,
                    (
                        client,
                        "egrz",
                        args.egrz_number,
                        args.timeout,
                        args.attempts,
                        args.egrz_number,
                    ),
                ),
                (
                    "EIS",
                    check_registry,
                    (
                        client,
                        "eis",
                        args.eis_number,
                        args.timeout,
                        args.attempts,
                        args.eis_number,
                    ),
                ),
            ]
        )

    results = [execute_check(name, callback, values) for name, callback, values in checks]
    optional_sources = {name.upper() for name in args.optional_source}
    for item in results:
        item["blocking"] = item["name"].upper() not in optional_sources
    blocking_failed = [
        item["name"] for item in results
        if item["status"] == "fail" and item["blocking"]
    ]
    report = {
        "schema": "dnepr-source-gate/1.0",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "target": args.base_url or args.document_root,
        "passed": not blocking_failed,
        "checks": results,
    }
    write_report(args.report_json, report)

    passed = [item["name"] for item in results if item["status"] == "pass"]
    failed = [item["name"] for item in results if item["status"] == "fail"]
    print("SOURCE GATE SUMMARY: pass=%s fail=%s" % (",".join(passed) or "-", ",".join(failed) or "-"))
    if blocking_failed:
        print("Release gate failed. Blocking sources failed: %s." % ",".join(blocking_failed), file=sys.stderr)
        return 1
    optional_failed = [name for name in failed if name.upper() in optional_sources]
    if optional_failed:
        print("Release gate passed with monitored source degradation: %s." % ",".join(optional_failed))
    print("All blocking release-gate checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
