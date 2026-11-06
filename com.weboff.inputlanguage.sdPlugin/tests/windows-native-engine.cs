using System;
using System.Collections;
using System.Collections.Generic;
using Weboff.InputLanguage.Windows;

public static class Tests {
    static int failures = 0;
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static string Text(Dictionary<string, object> value, string key) { return value.ContainsKey(key) ? Convert.ToString(value[key]) : ""; }
    static Dictionary<string, object> Map(object value) { return (Dictionary<string, object>)value; }
    static List<object> Items(object value) { var result = new List<object>(); foreach (object item in (IEnumerable)value) result.Add(item); return result; }
    static string Id(long handle) { return handle.ToString("x16"); }
    static void Run(string name, Action test) { try { test(); Console.WriteLine("PASS " + name); } catch (Exception error) { failures++; Console.WriteLine("FAIL " + name + ": " + error.Message); } }
    sealed class Fake : IInputPlatform {
        public InputTarget Current = new InputTarget(100, 10, 0x409);
        public IList<InputLayout> Sources = new List<InputLayout> { new InputLayout(0x409, "English", "en"), new InputLayout(0x419, "Русский", "ru"), new InputLayout(0x10409, "English variant", "en") };
        public int Requests, Waits, RequestedTimeout; public InputTarget RequestedTarget; public long RequestedLayout;
        public bool Accepted = true, Apply = true, ChangeFocusAfterRequest;
        public InputTarget Capture() { return Current; }
        public IList<InputLayout> Layouts() { return Sources; }
        public bool RequestLayout(InputTarget target, long layout, int timeoutMs) {
            Requests++; RequestedTarget = target; RequestedLayout = layout; RequestedTimeout = timeoutMs;
            if (ChangeFocusAfterRequest) Current = new InputTarget(200, 20, Current.Layout);
            else if (Accepted && Apply) Current = new InputTarget(target.Window, target.ThreadId, layout);
            return Accepted;
        }
        public void Wait(int milliseconds) { Check(milliseconds > 0 && milliseconds <= 50, "readback waits are bounded"); Waits++; if (Waits > 100) throw new Exception("unbounded readback"); }
    }
    static string Token(Dictionary<string, object> snapshot) { Check(Text(snapshot, "type") == "state", "snapshot must return confirmed state"); var token = Text(snapshot, "targetToken"); Check(token.Length > 0 && token.Length <= 128, "snapshot binds a bounded foreground token"); return token; }
    static void Error(IList<Dictionary<string, object>> output, string code) {
        Check(output.Count >= 2 && Text(output[0], "type") == "state", "failure publishes actual confirmed state before error");
        Check(Text(output[output.Count - 1], "type") == "error" && Text(output[output.Count - 1], "code") == code, "fixed error code must match failure");
    }
    public static int Main() {
        Run("snapshot-identities-primary-utf8", () => {
            var fake = new Fake(); fake.Sources.Add(new InputLayout(0x409, "Duplicate", "de")); var engine = new InputEngine(fake); var snapshot = engine.Snapshot("s1"); Token(snapshot);
            Check(Text(snapshot, "id") == "s1", "snapshot correlation is retained");
            Check(Text(Map(snapshot["current"]), "id") == Id(0x409), "current source is foreground HKL");
            var sources = Items(snapshot["sources"]); Check(sources.Count == 3, "distinct variants retained, duplicate handles removed");
            Check(Text(Map(sources[1]), "name") == "Русский", "Cyrillic survives protocol objects");
            Check(Text(Map(sources[2]), "id") == Id(0x10409), "source IDs retain full handle bits");
            Check(fake.Requests == 0, "snapshot never mutates source");
        });
        Run("select-single-confirmed-target", () => {
            var fake = new Fake(); var engine = new InputEngine(fake); string token = Token(engine.Snapshot());
            var output = engine.Select("c1", Id(0x419), Id(0x409), token);
            Check(fake.Requests == 1 && fake.RequestedLayout == 0x419, "exactly one absolute layout request");
            Check(fake.RequestedTarget.Window == 100 && fake.RequestedTarget.ThreadId == 10, "only captured foreground target receives request");
            Check(fake.RequestedTimeout > 0 && fake.RequestedTimeout <= 500, "native dispatch is bounded");
            Check(output.Count == 1 && Text(output[0], "type") == "state", "success requires confirmed state");
            Check(Text(Map(output[0]["current"]), "id") == Id(0x419) && Text(output[0], "id") == "c1", "ack reports actual selected layout and correlation");
        });
        Run("same-layout-different-focus-conflict", () => {
            var fake = new Fake(); var engine = new InputEngine(fake); string token = Token(engine.Snapshot());
            fake.Current = new InputTarget(200, 20, 0x409);
            Error(engine.Select("c2", Id(0x419), Id(0x409), token), "conflict"); Check(fake.Requests == 0, "focus mismatch must never send a selection");
        });
        Run("external-layout-change-conflict", () => {
            var fake = new Fake(); var engine = new InputEngine(fake); string token = Token(engine.Snapshot()); fake.Current = new InputTarget(100, 10, 0x419);
            Error(engine.Select("c3", Id(0x10409), Id(0x409), token), "conflict"); Check(fake.Requests == 0, "changed current layout invalidates compare-and-set");
        });
        Run("rejected-and-unconfirmed-selection", () => {
            foreach (bool accepted in new [] { false, true }) {
                var fake = new Fake { Accepted = accepted, Apply = false }; var engine = new InputEngine(fake); string token = Token(engine.Snapshot());
                var output = engine.Select("c4", Id(0x419), Id(0x409), token); Error(output, "select_failed");
                Check(fake.Requests == 1 && fake.Waits <= 50, "rejected or timed-out request is bounded and never replayed");
                Check(Text(Map(output[0]["current"]), "id") == Id(0x409), "failure cannot invent target success");
            }
        });
        Run("focus-change-during-readback", () => {
            var fake = new Fake { ChangeFocusAfterRequest = true }; var engine = new InputEngine(fake); string token = Token(engine.Snapshot());
            Error(engine.Select("c5", Id(0x419), Id(0x409), token), "conflict"); Check(fake.Requests == 1, "readback focus change never retargets or broadcasts");
        });
        Console.WriteLine("native-engine failures=" + failures); return failures == 0 ? 0 : 1;
    }
}
