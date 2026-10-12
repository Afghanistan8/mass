import os
import tempfile

# genlayer-testing-suite v0.29 swaps stdin for a temp file; Windows keeps the
# descriptor open so os.unlink raises WinError 32. Tolerate that for temp files.
_unlink = os.unlink


def _windows_safe_unlink(path):
    try:
        _unlink(path)
    except PermissionError:
        if not str(path).startswith(tempfile.gettempdir()):
            raise


os.unlink = _windows_safe_unlink
