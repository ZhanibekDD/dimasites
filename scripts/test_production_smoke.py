#!/usr/bin/env python3
"""Offline regression tests for the production release gate."""

import importlib.util
import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("production_smoke.py")
SPEC = importlib.util.spec_from_file_location("production_smoke", str(MODULE_PATH))
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)


class ProductionSmokeTests(unittest.TestCase):
    def test_execute_check_records_failure_without_raising(self):
        def broken():
            raise SMOKE.SmokeFailure("integration_changed")

        result = SMOKE.execute_check("EGRZ", broken, ())
        self.assertEqual(result["name"], "EGRZ")
        self.assertEqual(result["status"], "fail")
        self.assertIn("integration_changed", result["error"])

    def test_all_checks_run_when_middle_source_fails(self):
        called = []

        def passed(name):
            called.append(name)
            return {"source": name.lower()}

        def failed(name):
            called.append(name)
            raise SMOKE.SmokeFailure("%s unavailable" % name)

        checks = [
            ("FNS", passed, ("FNS",)),
            ("EGRZ", failed, ("EGRZ",)),
            ("EIS", passed, ("EIS",)),
        ]
        results = [SMOKE.execute_check(name, callback, args) for name, callback, args in checks]
        self.assertEqual(called, ["FNS", "EGRZ", "EIS"])
        self.assertEqual([item["status"] for item in results], ["pass", "fail", "pass"])

    def test_json_report_is_atomic_and_machine_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "source-gate.json")
            expected = {"passed": False, "checks": [{"name": "EGRZ", "status": "fail"}]}
            SMOKE.write_report(path, expected)
            with open(path, "r", encoding="utf-8") as handle:
                self.assertEqual(json.load(handle), expected)
            self.assertFalse(Path(path + ".tmp").exists())

    def test_optional_source_failure_does_not_block_release(self):
        results = [
            {"name": "RELEASE", "status": "pass", "details": {}},
            {"name": "FNS", "status": "pass", "details": {}},
            {"name": "EGRZ", "status": "fail", "error": "integration_changed"},
            {"name": "EIS", "status": "pass", "details": {}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            report_path = str(Path(directory) / "gate.json")
            argv = [
                "production_smoke.py",
                "--document-root",
                directory,
                "--expected-version",
                "release-1",
                "--optional-source",
                "EGRZ",
                "--report-json",
                report_path,
            ]
            with mock.patch.object(sys, "argv", argv), mock.patch.object(
                SMOKE, "execute_check", side_effect=results
            ):
                self.assertEqual(SMOKE.main(), 0)
            with open(report_path, "r", encoding="utf-8") as handle:
                report = json.load(handle)
            self.assertTrue(report["passed"])
            egrz = next(item for item in report["checks"] if item["name"] == "EGRZ")
            self.assertFalse(egrz["blocking"])

    def test_blocking_source_failure_rejects_release(self):
        results = [
            {"name": "RELEASE", "status": "pass", "details": {}},
            {"name": "FNS", "status": "fail", "error": "transport"},
            {"name": "EGRZ", "status": "fail", "error": "integration_changed"},
            {"name": "EIS", "status": "pass", "details": {}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            argv = [
                "production_smoke.py",
                "--document-root",
                directory,
                "--expected-version",
                "release-1",
                "--optional-source",
                "EGRZ",
            ]
            with mock.patch.object(sys, "argv", argv), mock.patch.object(
                SMOKE, "execute_check", side_effect=results
            ):
                self.assertEqual(SMOKE.main(), 1)


if __name__ == "__main__":
    unittest.main()
