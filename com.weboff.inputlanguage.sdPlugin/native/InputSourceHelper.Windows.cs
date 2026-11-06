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
    public static class Program {
        public static int Main(string[] args) {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            Console.InputEncoding = new System.Text.UTF8Encoding(false);
            Console.WriteLine(new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "type", "error" }, { "code", "unavailable" } }));
            return 0;
        }
    }
}

