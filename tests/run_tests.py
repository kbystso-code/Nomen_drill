"""macOS標準のJavaScriptCoreで実際のapp.jsの回帰テストを実行。外部依存なし。"""
import ctypes
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
jsc = ctypes.CDLL('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/JavaScriptCore')
pointer = ctypes.c_void_p
jsc.JSGlobalContextCreate.argtypes = [pointer]
jsc.JSGlobalContextCreate.restype = pointer
jsc.JSStringCreateWithUTF8CString.argtypes = [ctypes.c_char_p]
jsc.JSStringCreateWithUTF8CString.restype = pointer
jsc.JSEvaluateScript.argtypes = [pointer, pointer, pointer, pointer, ctypes.c_int, ctypes.POINTER(pointer)]
jsc.JSEvaluateScript.restype = pointer
jsc.JSValueToStringCopy.argtypes = [pointer, pointer, ctypes.POINTER(pointer)]
jsc.JSValueToStringCopy.restype = pointer
jsc.JSStringGetMaximumUTF8CStringSize.argtypes = [pointer]
jsc.JSStringGetMaximumUTF8CStringSize.restype = ctypes.c_size_t
jsc.JSStringGetUTF8CString.argtypes = [pointer, ctypes.c_void_p, ctypes.c_size_t]
jsc.JSStringGetUTF8CString.restype = ctypes.c_size_t
jsc.JSStringRelease.argtypes = [pointer]
jsc.JSGlobalContextRelease.argtypes = [pointer]
source = 'const APP_SOURCE = ' + json.dumps((root / 'app.js').read_text()) + ';\n'
source += 'const DATA = ' + (root / 'data/nouns.json').read_text() + '.nouns;\n'
source += (root / 'tests/session.js').read_text()
context = jsc.JSGlobalContextCreate(None)
script = jsc.JSStringCreateWithUTF8CString(source.encode())
exception = pointer()
result = jsc.JSEvaluateScript(context, script, None, None, 1, ctypes.byref(exception))
text = jsc.JSValueToStringCopy(context, exception.value or result, None)
size = jsc.JSStringGetMaximumUTF8CStringSize(text)
buffer = ctypes.create_string_buffer(size)
jsc.JSStringGetUTF8CString(text, buffer, size)
output = buffer.value.decode()
jsc.JSStringRelease(text)
jsc.JSStringRelease(script)
jsc.JSGlobalContextRelease(context)
if exception.value:
    raise SystemExit('FAIL: ' + output)
for line in json.loads(output):
    print('PASS: ' + line)
