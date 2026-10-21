"""03 CI entry point; discovers detector tests independently of shell cwd."""
from pathlib import Path
import argparse
import sys
import unittest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--integration", action="store_true", help="also run 04 HTTP -> real 03 checks")
    args = parser.parse_args()
    folder = Path(__file__).resolve().parent
    suite = unittest.defaultTestLoader.discover(str(folder), pattern="test_*.py")
    if args.integration:
        suite.addTests(unittest.TestLoader().discover(str(folder / "integration"), pattern="test_*.py"))
    count = suite.countTestCases()
    if not count:
        print("ERROR: no inspection tests discovered", file=sys.stderr)
        return 2
    print(f"03 inspection: {count} tests; synthetic behavior checks, not accuracy", flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
