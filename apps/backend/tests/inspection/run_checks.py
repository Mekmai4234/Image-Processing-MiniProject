"""03 CI entry point; discovers detector tests independently of shell cwd."""
from pathlib import Path
import sys
import unittest


def main():
    folder = Path(__file__).resolve().parent
    suite = unittest.defaultTestLoader.discover(str(folder), pattern="test_*.py")
    count = suite.countTestCases()
    if not count:
        print("ERROR: no inspection tests discovered", file=sys.stderr)
        return 2
    print(f"03 inspection: {count} tests; synthetic behavior checks, not accuracy", flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
