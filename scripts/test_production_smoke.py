#!/usr/bin/env python3
"""Offline regression tests for the production release gate."""

import importlib.util
import json
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
