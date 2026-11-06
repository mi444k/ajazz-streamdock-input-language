$ErrorActionPreference = 'Stop'
# Behavioral tests use injected fake OS backends and never change input sources or open applications.
$root = Split-Path $PSScriptRoot -Parent
$csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path $csc)) { throw 'The Windows .NET Framework C# compiler is required.' }
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('streamdock-native-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $executable = Join-Path $temporary 'native-engine-tests.exe'
    & $csc /nologo /target:exe /main:Tests /optimize+ /debug- /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll /reference:Microsoft.CSharp.dll "/out:$executable" (Join-Path $root 'native/InputSourceHelper.Windows.cs') (Join-Path $PSScriptRoot 'windows-native-engine.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Native test compilation failed; this is infrastructure failure, not behavioral Red.' }
    & $executable
    if ($LASTEXITCODE -ne 0) { throw 'Native behavioral acceptance checks failed.' }
} finally {
    Remove-Item -Recurse -Force $temporary
}
