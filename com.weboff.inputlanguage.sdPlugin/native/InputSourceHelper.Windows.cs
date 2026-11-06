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
        public InputEngine(IInputPlatform platform) { }
        public Dictionary<string, object> Snapshot(string requestId = null) { return new Dictionary<string, object> { { "type", "error" }, { "code", "unavailable" } }; }
        public IList<Dictionary<string, object>> Select(string requestId, string sourceId, string expectedCurrentId, string expectedTargetToken) { return new List<Dictionary<string, object>>(); }
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

