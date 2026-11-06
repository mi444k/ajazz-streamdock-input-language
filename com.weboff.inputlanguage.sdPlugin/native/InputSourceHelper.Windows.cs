using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace Weboff.InputLanguage.Windows {
    public sealed class InputLayout {
        public readonly long Handle;
        public readonly string Name;
        public readonly string Language;
        public InputLayout(long handle, string name, string language) { Handle = handle; Name = name; Language = language; }
    }
    public sealed class InputTarget {
        public readonly long Window;
        public readonly uint ThreadId;
        public readonly long Layout;
        public InputTarget(long window, uint threadId, long layout) { Window = window; ThreadId = threadId; Layout = layout; }
    }
    public interface IInputPlatform {
        InputTarget Capture();
        IList<InputLayout> Layouts();
        bool RequestLayout(InputTarget target, long layout, int timeoutMs);
        void Wait(int milliseconds);
    }
    public sealed class InputEngine {
        private readonly IInputPlatform platform;
        private readonly object gate = new object();
        private long revision = 0;
        private InputTarget boundTarget;
        private string token;
        public InputEngine(IInputPlatform platform) { if (platform == null) throw new ArgumentNullException("platform"); this.platform = platform; }
        private static string Id(long layout) { return layout.ToString("x16"); }
        private static bool SafeText(string value, int maximum) {
            if (String.IsNullOrWhiteSpace(value) || value.Length > maximum) return false;
            foreach (char c in value) if (Char.IsControl(c)) return false;
            return true;
        }
        private List<InputLayout> Sources() {
            var input = platform.Layouts();
            if (input == null || input.Count > 256) throw new InvalidOperationException();
            var result = new List<InputLayout>(); var ids = new HashSet<long>();
            foreach (var item in input) {
                if (item == null || item.Handle == 0 || !SafeText(item.Name, 1024) || item.Language == null || item.Language.Length > 64) throw new InvalidOperationException();
                foreach (char c in item.Language) if (Char.IsControl(c)) throw new InvalidOperationException();
                if (ids.Add(item.Handle)) result.Add(item);
            }
            return result;
        }
        private static Dictionary<string, object> Source(InputLayout layout) {
            return new Dictionary<string, object> { { "id", Id(layout.Handle) }, { "name", layout.Name }, { "languages", layout.Language.Length == 0 ? new string[0] : new [] { layout.Language } } };
        }
        private static bool SameTarget(InputTarget first, InputTarget second) { return first != null && second != null && first.Window == second.Window && first.ThreadId == second.ThreadId; }
        private Dictionary<string, object> State(InputTarget target, List<InputLayout> sources, string requestId) {
            if (target == null) throw new InvalidOperationException();
            if (!SameTarget(boundTarget, target) || token == null) { token = Guid.NewGuid().ToString("N"); boundTarget = target; }
            var values = new List<object>(); Dictionary<string, object> current = null;
            foreach (var layout in sources) { var value = Source(layout); values.Add(value); if (layout.Handle == target.Layout) current = value; }
            if (current == null && target.Layout != 0) current = Source(new InputLayout(target.Layout, "Unknown input source", ""));
            var state = new Dictionary<string, object> { { "type", "state" }, { "revision", ++revision }, { "current", current }, { "sources", values }, { "targetToken", token } };
            if (requestId != null) state["id"] = requestId;
            return state;
        }
        public Dictionary<string, object> Snapshot(string requestId = null) {
            lock (gate) { return State(platform.Capture(), Sources(), requestId); }
        }
        private IList<Dictionary<string, object>> Failure(string requestId, string code, InputTarget actual, List<InputLayout> sources) {
            return new List<Dictionary<string, object>> { State(actual, sources, null), new Dictionary<string, object> { { "type", "error" }, { "id", requestId }, { "code", code } } };
        }
        public IList<Dictionary<string, object>> Select(string requestId, string sourceId, string expectedCurrentId, string expectedTargetToken) {
            lock (gate) {
                var actual = platform.Capture(); var sources = Sources();
                if (!SameTarget(boundTarget, actual) || token == null || token != expectedTargetToken || Id(actual.Layout) != expectedCurrentId) return Failure(requestId, "conflict", actual, sources);
                InputLayout requested = null;
                foreach (var item in sources) if (Id(item.Handle) == sourceId) requested = item;
                if (requested == null || actual.Window == 0 || actual.ThreadId == 0) return Failure(requestId, "invalid_command", actual, sources);
                var target = actual;
                if (!platform.RequestLayout(target, requested.Handle, 500)) return Failure(requestId, "select_failed", platform.Capture(), Sources());
                for (int count = 0; count <= 50; count++) {
                    actual = platform.Capture();
                    if (!SameTarget(target, actual)) return Failure(requestId, "conflict", actual, Sources());
                    if (actual.Layout == requested.Handle) return new List<Dictionary<string, object>> { State(actual, Sources(), requestId) };
                    if (count < 50) platform.Wait(20);
                }
                return Failure(requestId, "select_failed", actual, Sources());
            }
        }
    }
    public sealed class WindowsInputPlatform : IInputPlatform {
        [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint threadId);
        [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern int GetKeyboardLayoutList(int count, [System.Runtime.InteropServices.Out] IntPtr[] layouts);
        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
        public InputTarget Capture() {
            var window = GetForegroundWindow(); uint processId;
            uint thread = window == IntPtr.Zero ? 0 : GetWindowThreadProcessId(window, out processId);
            var layout = thread == 0 ? IntPtr.Zero : GetKeyboardLayout(thread);
            return new InputTarget(window.ToInt64(), thread, layout.ToInt64());
        }
        public IList<InputLayout> Layouts() {
            int count = GetKeyboardLayoutList(0, null);
            if (count < 1 || count > 256) throw new InvalidOperationException();
            var handles = new IntPtr[count]; int actual = GetKeyboardLayoutList(count, handles);
            if (actual < 1 || actual > count) throw new InvalidOperationException();
            var result = new List<InputLayout>();
            for (int index = 0; index < actual; index++) {
                long handle = handles[index].ToInt64(); string name = "Keyboard layout " + handle.ToString("x16"), language = "";
                try { var culture = System.Globalization.CultureInfo.GetCultureInfo((int)(handle & 0xffff)); name = culture.EnglishName; language = culture.Name; } catch (System.Globalization.CultureNotFoundException) { }
                result.Add(new InputLayout(handle, name, language));
            }
            return result;
        }
        public bool RequestLayout(InputTarget target, long layout, int timeoutMs) {
            var actual = Capture();
            if (target.Window == 0 || target.ThreadId == 0 || actual.Window != target.Window || actual.ThreadId != target.ThreadId || actual.Layout != target.Layout) return false;
            IntPtr result;
            return SendMessageTimeout(new IntPtr(target.Window), 0x0050, IntPtr.Zero, new IntPtr(layout), 0x0001 | 0x0002, (uint)timeoutMs, out result) != IntPtr.Zero;
        }
        public void Wait(int milliseconds) { System.Threading.Thread.Sleep(milliseconds); }
    }
    public static class Program {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 65536 };
        private static string fingerprint;
        private static bool ValidId(object value) { return value is string && System.Text.RegularExpressions.Regex.IsMatch((string)value, "^[A-Za-z0-9_-]{1,128}$"); }
        private static Dictionary<string, object> Error(string id, string code) { return new Dictionary<string, object> { { "type", "error" }, { "id", id }, { "code", code } }; }
        private static void Emit(Dictionary<string, object> value) {
            string text;
            try { text = Json.Serialize(value); if (System.Text.Encoding.UTF8.GetByteCount(text) > 65536) throw new InvalidOperationException(); }
            catch { text = Json.Serialize(Error(value.ContainsKey("id") ? Convert.ToString(value["id"]) : "unavailable", "unavailable")); }
            Console.WriteLine(text); Console.Out.Flush();
        }
        private static string Fingerprint(Dictionary<string, object> state) {
            return Json.Serialize(new object[] { state["current"], state["sources"], state["targetToken"] });
        }
        private static void Publish(Dictionary<string, object> state, bool always) {
            var next = Fingerprint(state);
            if (always || next != fingerprint) { fingerprint = next; Emit(state); }
        }
        private static void Command(InputEngine engine, byte[] bytes, bool oversized) {
            string id = "invalid";
            try {
                if (oversized) throw new InvalidOperationException();
                var text = new System.Text.UTF8Encoding(false, true).GetString(bytes);
                var value = Json.DeserializeObject(text) as Dictionary<string, object>;
                if (value == null || !value.ContainsKey("id") || !ValidId(value["id"])) throw new InvalidOperationException();
                id = (string)value["id"];
                object command; if (!value.TryGetValue("command", out command)) throw new InvalidOperationException();
                if (Convert.ToString(command) == "snapshot") { Publish(engine.Snapshot(id), true); return; }
                object source, expected, target;
                if (Convert.ToString(command) != "select" || !value.TryGetValue("sourceId", out source) || !(source is string) || !System.Text.RegularExpressions.Regex.IsMatch((string)source, "^[a-f0-9]{16}$") || !value.TryGetValue("expectedCurrentId", out expected) || !(expected is string) || !value.TryGetValue("expectedTargetToken", out target) || !ValidId(target)) throw new InvalidOperationException();
                foreach (var output in engine.Select(id, (string)source, (string)expected, (string)target)) {
                    if (Convert.ToString(output["type"]) == "state") Publish(output, true); else Emit(output);
                }
            } catch { Emit(Error(id, "invalid_command")); }
        }
        [STAThread]
        public static int Main(string[] args) {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            Console.InputEncoding = new System.Text.UTF8Encoding(false);
            try {
                var engine = new InputEngine(new WindowsInputPlatform());
                if (args.Length == 1 && args[0] == "--snapshot") { Emit(engine.Snapshot()); return 0; }
                if (args.Length != 0) { Emit(Error("invalid", "invalid_command")); return 0; }
                using (var control = new System.Windows.Forms.Control()) {
                    var handle = control.Handle;
                    using (var timer = new System.Windows.Forms.Timer { Interval = 250 }) {
                        timer.Tick += delegate { try { Publish(engine.Snapshot(), false); } catch { Emit(Error("unavailable", "unavailable")); System.Windows.Forms.Application.ExitThread(); } };
                        var reader = new System.Threading.Thread(delegate() {
                            try {
                                var input = Console.OpenStandardInput(); var chunk = new byte[4096]; var line = new List<byte>(); bool oversized = false; int read;
                                while ((read = input.Read(chunk, 0, chunk.Length)) > 0) {
                                    for (int index = 0; index < read; index++) {
                                        byte item = chunk[index];
                                        if (item == 10) {
                                            var complete = line.ToArray(); bool rejected = oversized; line.Clear(); oversized = false;
                                            control.BeginInvoke((Action)delegate { Command(engine, complete, rejected); });
                                        } else if (!oversized) {
                                            if (line.Count == 65536) { oversized = true; line.Clear(); } else line.Add(item);
                                        }
                                    }
                                }
                                if (line.Count > 0 || oversized) {
                                    var complete = line.ToArray(); bool rejected = oversized;
                                    control.BeginInvoke((Action)delegate { Command(engine, complete, rejected); });
                                }
                            } catch { }
                            try { control.BeginInvoke((Action)delegate { System.Windows.Forms.Application.ExitThread(); }); } catch { }
                        });
                        reader.IsBackground = true; reader.Start(); timer.Start();
                        System.Windows.Forms.Application.Run(); timer.Stop();
                    }
                }
            } catch { Emit(Error("unavailable", "unavailable")); }
            return 0;
        }
    }
}

