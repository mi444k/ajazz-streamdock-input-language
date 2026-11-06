$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'
if (-not (Test-Path $compiler)) { throw 'The .NET Framework C# compiler is unavailable.' }
$source = Join-Path $pluginRoot 'native\\InputSourceHelper.Windows.cs'
$output = Join-Path $pluginRoot 'native\\input-source-helper.exe'
& $compiler /nologo /optimize+ /debug- /target:exe /platform:anycpu /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll /reference:Microsoft.CSharp.dll /out:$output $source
if ($LASTEXITCODE -ne 0) { throw 'Windows helper compilation failed.' }

