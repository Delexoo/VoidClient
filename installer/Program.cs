using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace UpdateVencord;

static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.Run(new InstallerForm());
    }
}

sealed class RoundButton : Control
{
    public Color HoverColor { get; set; }
    public int CornerRadius { get; set; } = 8;
    public bool Ghost { get; set; }
    bool _hover;
    bool _pressed;

    public RoundButton()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
        Cursor = Cursors.Hand;
        Height = 44;
        Font = new Font("Segoe UI Semibold", 10f);
    }

    protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { _hover = false; _pressed = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
    protected override void OnMouseDown(MouseEventArgs e) { _pressed = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (Enabled && (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space))
        {
            e.Handled = true;
            OnClick(EventArgs.Empty);
            return;
        }
        base.OnKeyDown(e);
    }
    protected override void OnMouseUp(MouseEventArgs e)
    {
        var wasPressed = _pressed;
        _pressed = false;
        Invalidate();
        if (wasPressed && e.Button == MouseButtons.Left && ClientRectangle.Contains(e.Location) && Enabled)
            OnClick(EventArgs.Empty);
        base.OnMouseUp(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent?.BackColor ?? Color.FromArgb(30, 31, 34));
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        var rect = ClientRectangle;
        rect.Inflate(-1, -1);
        Color fill;
        Color text = ForeColor;
        if (Ghost)
        {
            fill = !Enabled ? Color.Transparent :
                _pressed ? Color.FromArgb(28, 255, 255, 255) :
                _hover ? Color.FromArgb(16, 255, 255, 255) : Color.Transparent;
            text = !Enabled ? Color.FromArgb(110, 116, 128) :
                _hover ? Color.White : ForeColor;
        }
        else
        {
            fill = !Enabled ? Color.FromArgb(72, 78, 92) :
                _pressed ? ControlPaint.Dark(BackColor) :
                _hover ? HoverColor : BackColor;
        }

        using var path = RoundRect(rect, CornerRadius);
        using (var brush = new SolidBrush(fill))
            e.Graphics.FillPath(brush, path);

        if (Focused && Enabled)
        {
            using var pen = new Pen(Color.FromArgb(180, 198, 208, 255), 1.5f);
            e.Graphics.DrawPath(pen, path);
        }

        TextRenderer.DrawText(
            e.Graphics,
            Text,
            Font,
            rect,
            text,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
    }

    static GraphicsPath RoundRect(Rectangle bounds, int radius)
    {
        int d = Math.Max(2, radius * 2);
        var path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

sealed class ProgressPill : Control
{
    float _value;
    public float Value
    {
        get => _value;
        set { _value = Math.Clamp(value, 0f, 1f); Invalidate(); }
    }
    public Color FillColor { get; set; } = Color.FromArgb(88, 101, 242);
    public Color TrackColor { get; set; } = Color.FromArgb(24, 25, 28);

    public ProgressPill()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw | ControlStyles.UserPaint | ControlStyles.Opaque, true);
        Height = 6;
        BackColor = Color.FromArgb(43, 45, 49);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(BackColor);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;

        var track = ClientRectangle;
        track.Inflate(0, -1);
        if (track.Height < 4) track = ClientRectangle;

        using (var path = Capsule(track))
        using (var brush = new SolidBrush(TrackColor))
            e.Graphics.FillPath(brush, path);

        if (_value <= 0.001f) return;
        var fillW = Math.Max(track.Height, (int)(track.Width * _value));
        var fill = new Rectangle(track.X, track.Y, fillW, track.Height);
        using var fpath = Capsule(fill);
        using var fillBrush = new SolidBrush(FillColor);
        e.Graphics.FillPath(fillBrush, fpath);
    }

    static GraphicsPath Capsule(Rectangle r)
    {
        int d = r.Height;
        var path = new GraphicsPath();
        path.AddArc(r.X, r.Y, d, d, 90, 180);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 180);
        path.CloseFigure();
        return path;
    }
}

sealed class InstallerForm : Form
{
    static readonly Color Bg = Color.FromArgb(30, 31, 34);
    static readonly Color LogBg = Color.FromArgb(20, 21, 24);
    static readonly Color Track = Color.FromArgb(58, 62, 70);
    static readonly Color Muted = Color.FromArgb(148, 155, 164);
    static readonly Color Soft = Color.FromArgb(219, 222, 225);
    static readonly Color Accent = Color.FromArgb(88, 101, 242);
    static readonly Color AccentHover = Color.FromArgb(121, 131, 255);
    static readonly Color Success = Color.FromArgb(35, 165, 89);
    static readonly Color Danger = Color.FromArgb(237, 66, 69);

    readonly Label _version;
    readonly Label _step;
    readonly Label _status;
    readonly Label _pct;
    readonly ProgressPill _bar;
    readonly Panel _body;
    readonly Panel _logWrap;
    readonly TextBox _log;
    readonly RoundButton _primary;
    readonly RoundButton _secondary;
    readonly string _installRoot;
    readonly string _toolsDir;
    Process? _proc;
    bool _running;
    bool _detailsOpen;
    string? _lastCloneLine;
    const int WindowWidth = 440;
    const int CompactHeight = 236;
    const int DetailsHeight = 460;

    public InstallerForm()
    {
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = "Void Client";
        Font = new Font("Segoe UI", 10f);
        ClientSize = new Size(WindowWidth, CompactHeight);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        MinimizeBox = true;
        ShowInTaskbar = true;
        BackColor = Bg;
        ForeColor = Soft;
        DoubleBuffered = true;
        Padding = new Padding(0);

        _installRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "DelexooVencord");
        _toolsDir = Path.Combine(_installRoot, "tools");

        var header = new Panel
        {
            Dock = DockStyle.Top,
            Height = 64,
            BackColor = Bg
        };

        var title = new Label
        {
            Text = "Void Client",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 18f),
            ForeColor = Color.White,
            Location = new Point(28, 18),
            BackColor = Bg
        };

        _version = new Label
        {
            Text = $"v{Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.8.4"}",
            AutoSize = true,
            Font = new Font("Segoe UI", 9f),
            ForeColor = Muted,
            BackColor = Bg
        };
        header.Controls.Add(title);
        header.Controls.Add(_version);
        header.Resize += (_, _) =>
        {
            _version.Left = header.ClientSize.Width - 28 - _version.Width;
            _version.Top = 26;
        };

        var footer = new Panel
        {
            Dock = DockStyle.Bottom,
            Height = 72,
            BackColor = Bg
        };

        _primary = new RoundButton
        {
            Text = "Please wait",
            Location = new Point(28, 14),
            Size = new Size(148, 44),
            BackColor = Accent,
            HoverColor = AccentHover,
            ForeColor = Color.White,
            CornerRadius = 8,
            Font = new Font("Segoe UI Semibold", 10f),
            Enabled = false
        };
        _primary.Click += async (_, _) => await RunAsync();

        _secondary = new RoundButton
        {
            Text = "Details",
            Location = new Point(188, 14),
            Size = new Size(100, 44),
            Ghost = true,
            BackColor = Bg,
            ForeColor = Muted,
            CornerRadius = 8,
            Font = new Font("Segoe UI Semibold", 10f)
        };
        _secondary.Click += (_, _) => ShowDetails(!_detailsOpen);
        footer.Controls.Add(_primary);
        footer.Controls.Add(_secondary);

        _body = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Bg
        };

        _step = new Label
        {
            Text = "Installing",
            AutoSize = false,
            Font = new Font("Segoe UI Semibold", 13f),
            ForeColor = Color.White,
            Location = new Point(28, 8),
            Size = new Size(280, 26),
            BackColor = Bg
        };

        _pct = new Label
        {
            Text = "0%",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 11f),
            ForeColor = Muted,
            BackColor = Bg
        };

        _status = new Label
        {
            Text = "Discord will close, then open again.",
            AutoSize = false,
            Size = new Size(384, 40),
            Font = new Font("Segoe UI", 10f),
            ForeColor = Muted,
            Location = new Point(28, 36),
            BackColor = Bg
        };

        _bar = new ProgressPill
        {
            Location = new Point(28, 86),
            Size = new Size(384, 6),
            BackColor = Bg,
            FillColor = Accent,
            TrackColor = Track
        };

        _logWrap = new Panel
        {
            BackColor = LogBg,
            Visible = false
        };

        var mono = FontFamily.Families.Any(f => f.Name == "Cascadia Mono") ? "Cascadia Mono" : "Consolas";
        _log = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            BorderStyle = BorderStyle.None,
            ScrollBars = ScrollBars.Vertical,
            Dock = DockStyle.Fill,
            BackColor = LogBg,
            ForeColor = Muted,
            Font = new Font(mono, 9f),
            TabStop = false
        };
        _log.HandleCreated += (_, _) => TryDarkScroll(_log.Handle);
        _logWrap.Controls.Add(_log);
        _logWrap.Padding = new Padding(12, 10, 4, 10);

        _body.Controls.Add(_logWrap);
        _body.Controls.Add(_bar);
        _body.Controls.Add(_status);
        _body.Controls.Add(_pct);
        _body.Controls.Add(_step);
        _body.Resize += (_, _) => LayoutBody();

        Controls.Add(_body);
        Controls.Add(footer);
        Controls.Add(header);

        HandleCreated += (_, _) =>
        {
            TryImmersiveDark(Handle);
            if (_log.IsHandleCreated) TryDarkScroll(_log.Handle);
        };

        ClientSize = new Size(WindowWidth, CompactHeight);

        Load += (_, _) => LayoutBody();
        Shown += async (_, _) => await RunAsync();
        FormClosing += (_, _) =>
        {
            if (_running && _proc is { HasExited: false })
            {
                try { _proc.Kill(entireProcessTree: true); } catch { }
            }
        };
    }

    [DllImport("uxtheme.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    static extern int SetWindowTheme(IntPtr hwnd, string pszSubAppName, string? pszSubIdList);

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    static void TryDarkScroll(IntPtr hwnd)
    {
        try
        {
            SetWindowTheme(hwnd, "DarkMode_Explorer", null);
            // Theme scrollbar child HWNDs (TextBox hosts them separately)
            const uint GwChild = 5;
            const uint GwHwndNext = 2;
            for (var child = GetWindow(hwnd, GwChild); child != IntPtr.Zero; child = GetWindow(child, GwHwndNext))
                SetWindowTheme(child, "DarkMode_Explorer", null);
        }
        catch { /* ignore */ }
    }

    static void TryImmersiveDark(IntPtr hwnd)
    {
        try
        {
            const int DwmwaUseImmersiveDarkMode = 20;
            int on = 1;
            _ = DwmSetWindowAttribute(hwnd, DwmwaUseImmersiveDarkMode, ref on, sizeof(int));
        }
        catch { /* ignore */ }
    }

    static GraphicsPath RoundRect(Rectangle bounds, int radius)
    {
        int d = Math.Max(2, radius * 2);
        var path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    void LayoutBody()
    {
        const int pad = 28;
        var innerW = Math.Max(160, _body.ClientSize.Width - pad * 2);
        _step.Width = Math.Max(80, innerW - 72);
        _status.SetBounds(pad, 38, innerW, 44);
        _bar.SetBounds(pad, 92, innerW, 6);
        var pctW = TextRenderer.MeasureText(_pct.Text, _pct.Font).Width;
        _pct.Left = pad + innerW - pctW;
        _pct.Top = _step.Top + 3;
        if (!_detailsOpen) return;
        var top = _bar.Bottom + 20;
        _logWrap.SetBounds(pad, top, innerW, Math.Max(80, _body.ClientSize.Height - top - 4));
    }

    void ShowDetails(bool open)
    {
        _detailsOpen = open;
        _logWrap.Visible = open;
        _secondary.Text = open ? "Hide" : "Details";
        ClientSize = new Size(WindowWidth, open ? DetailsHeight : CompactHeight);
        LayoutBody();
        _secondary.Invalidate();
    }

    void SetProgress(int pct)
    {
        pct = Math.Clamp(pct, 0, 100);
        _bar.Value = pct / 100f;
        _bar.FillColor = pct >= 100 ? Success : Accent;
        _pct.Text = $"{pct}%";
        _pct.ForeColor = pct >= 100 ? Success : Muted;
        LayoutBody();
    }

    void SetUi(string step, string status, Color? stepColor = null)
    {
        _step.Text = step;
        _step.ForeColor = stepColor is { } color && color.ToArgb() != Accent.ToArgb()
            ? color
            : Color.White;
        _status.Text = status;
        _status.ForeColor = Muted;
    }

    void AppendLog(string line)
    {
        // Collapse noisy git clone percentage spam into one updating line feel
        if (Regex.IsMatch(line, @"Updating files:\s+\d+%"))
        {
            if (_lastCloneLine != null && _log.Lines.Length > 0)
            {
                var lines = _log.Lines.ToList();
                if (lines.Count > 0 && lines[^1].StartsWith("Updating files:", StringComparison.Ordinal))
                {
                    lines[^1] = line;
                    _log.Lines = lines.ToArray();
                    _log.SelectionStart = _log.TextLength;
                    _log.ScrollToCaret();
                    return;
                }
            }
            _lastCloneLine = line;
        }

        if (_log.TextLength > 0) _log.AppendText(Environment.NewLine);
        _log.AppendText(line);
    }

    static readonly string[] ScriptNames = ["UpdateVencord.ps1", "Update-Vencord.ps1"];

    static string? FindScriptBeside(params string[] roots)
    {
        foreach (var root in roots)
        {
            if (string.IsNullOrWhiteSpace(root)) continue;
            foreach (var name in ScriptNames)
            {
                var path = Path.Combine(root, name);
                if (File.Exists(path)) return path;
            }
        }
        return null;
    }

    void EnsurePayload()
    {
        Directory.CreateDirectory(_toolsDir);
        Directory.CreateDirectory(Path.Combine(_installRoot, "vencord-plugins"));

        // Prefer UpdateVencord.ps1 — Windows sometimes permanently locks Update-Vencord.ps1 in this folder.
        var destPreferred = Path.Combine(_toolsDir, "UpdateVencord.ps1");
        var destLegacy = Path.Combine(_toolsDir, "Update-Vencord.ps1");

        var candidates = new List<string>();
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (var name in ScriptNames)
        {
            candidates.Add(Path.Combine(home, @"OneDrive\Desktop\Vencord\installer", name));
            candidates.Add(Path.Combine(home, @"Desktop\Vencord\installer", name));
        }
        var exePath = Environment.ProcessPath ?? "";
        var exeDir = string.IsNullOrEmpty(exePath) ? "" : Path.GetDirectoryName(exePath) ?? "";
        if (!string.IsNullOrEmpty(exeDir))
        {
            foreach (var name in ScriptNames)
            {
                candidates.Add(Path.Combine(exeDir, name));
                candidates.Add(Path.Combine(exeDir, "tools", name));
                candidates.Add(Path.GetFullPath(Path.Combine(exeDir, "..", "..", name)));
            }
        }
        foreach (var name in ScriptNames)
            candidates.Add(Path.Combine(AppContext.BaseDirectory, name));

        foreach (var src in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!File.Exists(src)) continue;
            if (TryInstallScript(src, destPreferred) || TryInstallScript(src, destLegacy))
            {
                AppendLog("Installer engine ready.");
                return;
            }
        }

        var asm = Assembly.GetExecutingAssembly();
        var res = asm.GetManifestResourceNames()
            .FirstOrDefault(n =>
                n.EndsWith("UpdateVencord.ps1", StringComparison.OrdinalIgnoreCase) ||
                n.EndsWith("Update-Vencord.ps1", StringComparison.OrdinalIgnoreCase));
        if (res != null)
        {
            using var stream = asm.GetManifestResourceStream(res)!;
            foreach (var dest in new[] { destPreferred, destLegacy })
            {
                try
                {
                    using var fs = File.Create(dest);
                    stream.Position = 0;
                    stream.CopyTo(fs);
                    AppendLog("Installer engine ready.");
                    return;
                }
                catch (UnauthorizedAccessException) { /* try next name */ }
                catch (IOException) { /* try next name */ }
            }
        }

        // Already present from a previous install
        if (File.Exists(destPreferred) || File.Exists(destLegacy))
        {
            AppendLog("Installer engine ready (existing script).");
            return;
        }

        throw new FileNotFoundException("UpdateVencord.ps1 not found next to installer.");
    }

    static bool TryInstallScript(string src, string dest)
    {
        try
        {
            File.Copy(src, dest, overwrite: true);
            return true;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
        catch (IOException)
        {
            return false;
        }
    }

    static string? ReadGitHubToken()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var paths = new[]
        {
            Path.Combine(home, @"OneDrive\Desktop\Vencord\.env"),
            Path.Combine(home, @"Desktop\Vencord\.env"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DelexooVencord", ".env"),
        };
        foreach (var path in paths)
        {
            if (!File.Exists(path)) continue;
            try
            {
                foreach (var raw in File.ReadAllLines(path))
                {
                    var line = raw.Trim();
                    if (!line.StartsWith("GITHUB_TOKEN", StringComparison.OrdinalIgnoreCase)) continue;
                    var eq = line.IndexOf('=');
                    if (eq < 0) continue;
                    var value = line[(eq + 1)..].Trim();
                    if (value.Length > 0) return value;
                }
            }
            catch { /* ignore unreadable env files */ }
        }
        return null;
    }

    async Task RunAsync()
    {
        if (_running) return;
        _running = true;
        _primary.Text = "Please wait";
        _primary.Enabled = false;
        _primary.Invalidate();
        _log.Clear();
        _lastCloneLine = null;
        SetProgress(4);
        SetUi("Preparing", "Setting up installer…", Accent);

        try
        {
            EnsurePayload();
            var token = ReadGitHubToken();
            if (!string.IsNullOrEmpty(token))
            {
                try
                {
                    Directory.CreateDirectory(_installRoot);
                    File.WriteAllText(Path.Combine(_installRoot, ".env"), "GITHUB_TOKEN=" + token + Environment.NewLine);
                }
                catch { /* optional local token copy */ }
            }
            SetProgress(10);
            SetUi("Installing", "Closing Discord and syncing Void Client…", Accent);

            var script = FindScriptBeside(_toolsDir)
                ?? throw new FileNotFoundException("UpdateVencord.ps1 not found in tools folder.");
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\"",
                WorkingDirectory = _toolsDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            psi.Environment["SPYT_VENCORD_ROOT"] = _installRoot;
            psi.Environment["SPYT_UPDATE_VENCORD_NO_PAUSE"] = "1";
            psi.Environment["GIT_ASK_YESNO"] = "false";
            psi.Environment["GIT_TERMINAL_PROMPT"] = "0";
            if (!string.IsNullOrEmpty(token))
            {
                psi.Environment["GITHUB_TOKEN"] = token;
                psi.Environment["GH_TOKEN"] = token;
            }

            _proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            var tcs = new TaskCompletionSource<int>();

            _proc.OutputDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                BeginInvoke(() =>
                {
                    AppendLog(e.Data);
                    MapProgress(e.Data);
                });
            };
            _proc.ErrorDataReceived += (_, e) =>
            {
                if (string.IsNullOrWhiteSpace(e.Data)) return;
                if (e.Data.Contains("RemoteException", StringComparison.Ordinal)) return;
                BeginInvoke(() => AppendLog(e.Data));
            };
            _proc.Exited += (_, _) => tcs.TrySetResult(_proc.ExitCode);

            if (!_proc.Start())
                throw new InvalidOperationException("Failed to start installer engine.");

            _proc.BeginOutputReadLine();
            _proc.BeginErrorReadLine();

            var code = await tcs.Task.ConfigureAwait(true);
            if (code == 0)
            {
                SetProgress(100);
                SetUi("You're all set", "Discord is opening.", Success);
                AppendLog("Finished successfully.");
                CreateDesktopShortcut();
                await Task.Delay(1500);
                if (!IsDisposed) Close();
            }
            else
            {
                SetUi("Couldn't finish", "The notes below say what stopped it.", Danger);
                ShowDetails(true);
                AppendLog($"Exit code: {code}");
                _primary.Text = "Try again";
                _primary.Enabled = true;
                _primary.Invalidate();
            }
        }
        catch (Exception ex)
        {
            SetUi("Couldn't finish", ex.Message, Danger);
            ShowDetails(true);
            AppendLog(ex.Message);
            _primary.Text = "Try again";
            _primary.Enabled = true;
            _primary.Invalidate();
        }
        finally
        {
            _running = false;
            _proc = null;
        }
    }

    void MapProgress(string line)
    {
        if (line.Contains("Closing Discord", StringComparison.OrdinalIgnoreCase))
        {
            SetProgress(16);
            SetUi("Closing Discord", "Quitting Discord so files can update…", Accent);
        }
        else if (line.Contains("Cloning official", StringComparison.OrdinalIgnoreCase))
        {
            SetProgress(28);
            SetUi("First-time setup", "Downloading Void Client…", Accent);
        }
        else if (Regex.IsMatch(line, @"Updating files:\s+(\d+)%"))
        {
            var m = Regex.Match(line, @"Updating files:\s+(\d+)%");
            if (m.Success && int.TryParse(m.Groups[1].Value, out var p))
                SetProgress(28 + (int)(p * 0.18));
        }
        else if (line.Contains("Fetching official", StringComparison.OrdinalIgnoreCase) ||
                 line.Contains("Fetching upstream", StringComparison.OrdinalIgnoreCase))
        {
            SetProgress(48);
            SetUi("Updating Void Client", "Pulling the latest release…", Accent);
        }
        else if (line.Contains("Pulling plugins", StringComparison.OrdinalIgnoreCase))
        {
            SetProgress(58);
            SetUi("Plugins", "Adding plugins…", Accent);
        }
        else if (line.Contains("Installing pnpm", StringComparison.OrdinalIgnoreCase))
        {
            SetProgress(12);
            SetUi("Preparing", "Installing pnpm…", Accent);
        }
        else if (line.Contains("pnpm install", StringComparison.OrdinalIgnoreCase))
        {
            SetProgress(68);
            SetUi("Dependencies", "Installing packages…", Accent);
        }
        else if (line.Contains("pnpm build", StringComparison.OrdinalIgnoreCase) ||
                 line.Contains("Building Vencord", StringComparison.OrdinalIgnoreCase))
        {
            SetProgress(80);
            SetUi("Building", "Compiling Void Client…", Accent);
        }
        else if (line.Contains("Running installer", StringComparison.OrdinalIgnoreCase))
        {
            SetProgress(90);
            SetUi("Patching Discord", "Applying Void Client to Discord…", Accent);
        }
        else if (line.Contains("Starting Discord", StringComparison.OrdinalIgnoreCase))
        {
            SetProgress(96);
            SetUi("Almost done", "Restarting Discord…", Accent);
        }
        else if (line.Contains("Done successfully", StringComparison.OrdinalIgnoreCase))
        {
            SetProgress(100);
            SetUi("You're all set", "All done.", Success);
        }
    }

    void CreateDesktopShortcut()
    {
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var shortcutPath = Path.Combine(desktop, "Void Client Installer.lnk");
            var exe = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exe) || !File.Exists(exe)) return;

            var appDir = Path.Combine(_installRoot, "app");
            Directory.CreateDirectory(appDir);
            // Prefer unlocked name — Windows often locks "Vencord Plugins Installer.exe"
            var stableExe = Path.Combine(appDir, "VencordUpdater.exe");
            try { File.Copy(exe, stableExe, overwrite: true); }
            catch
            {
                stableExe = Path.Combine(appDir, "Vencord Plugins Installer.exe");
                try { File.Copy(exe, stableExe, overwrite: true); }
                catch { stableExe = exe; }
            }

            var scriptBeside = FindScriptBeside(_toolsDir);
            if (scriptBeside != null)
            {
                var appScript = Path.Combine(appDir, Path.GetFileName(scriptBeside));
                try { File.Copy(scriptBeside, appScript, overwrite: true); }
                catch { /* optional */ }
            }

            var ws = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
            dynamic sc = ((dynamic)ws).CreateShortcut(shortcutPath);
            sc.TargetPath = stableExe;
            sc.WorkingDirectory = appDir;
            sc.Description = "Install or update Void Client";
            sc.Save();
        }
        catch
        {
            // optional
        }
    }
}
