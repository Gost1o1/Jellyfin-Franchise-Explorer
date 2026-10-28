using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.FranchiseExplorer.Web;

/// <summary>
/// Optional, non-destructive Jellyfin Web integration. If the separate
/// JavaScript Injector plugin is installed, register a browser-only My Media
/// card. Franchise Explorer itself works when Injector is absent.
/// </summary>
public sealed class HomeTileRegistrationService : IHostedService, IDisposable
{
    private const string InjectorAssemblyName = "Jellyfin.Plugin.JavaScriptInjector";
    private const string ScriptResourceName = "Jellyfin.Plugin.FranchiseExplorer.Web.franchise-my-media.js";
    private readonly ILogger<HomeTileRegistrationService> _logger;
    private readonly CancellationTokenSource _stopping = new();
    private Task? _registrationTask;

    public HomeTileRegistrationService(ILogger<HomeTileRegistrationService> logger)
    {
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        // Do not block Jellyfin startup if the optional companion is missing
        // or loads after this hosted service.
        _registrationTask = Task.Run(() => RegisterWithRetriesAsync(_stopping.Token), CancellationToken.None);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _stopping.Cancel();
        if (_registrationTask is not null)
        {
            try
            {
                await _registrationTask.WaitAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Normal when Jellyfin is stopping.
            }
        }
    }

    public void Dispose() => _stopping.Dispose();

    private async Task RegisterWithRetriesAsync(CancellationToken cancellationToken)
    {
        // Allow optional JavaScript Injector to finish its own startup.
        // Bounded retry: no background polling after startup.
        for (var attempt = 0; attempt < 15; attempt++)
        {
            if (cancellationToken.IsCancellationRequested) return;
            try
            {
                if (TryRegister())
                {
                    _logger.LogInformation(
                        "Franchise Explorer: My Media web tile registered with the optional JavaScript Injector plugin.");
                    return;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Franchise Explorer: optional My Media tile registration attempt failed.");
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }

        _logger.LogInformation(
            "Franchise Explorer: optional JavaScript Injector integration unavailable; the standalone browser remains accessible. " +
            "Install JavaScript Injector and restart Jellyfin to add the web-only My Media card.");
    }

    private static bool TryRegister()
    {
        Assembly? injectorAssembly = AssemblyLoadContext.All
            .SelectMany(context => context.Assemblies)
            .FirstOrDefault(assembly =>
                string.Equals(assembly.GetName().Name, InjectorAssemblyName, StringComparison.Ordinal));
        if (injectorAssembly is null) return false;

        Type? interfaceType = injectorAssembly.GetType(InjectorAssemblyName + ".PluginInterface");
        MethodInfo? register = interfaceType?.GetMethod("RegisterScript", BindingFlags.Public | BindingFlags.Static);
        if (register is null) return false;
        ParameterInfo[] parameters = register.GetParameters();
        if (parameters.Length != 1) return false;

        // The companion expects its own Newtonsoft JObject. Instantiate the
        // *exact parameter type* by reflection to avoid AssemblyLoadContext
        // version conflicts; no third-party DLL is shipped with this plugin.
        Type payloadType = parameters[0].ParameterType;
        MethodInfo? parse = payloadType.GetMethod("Parse", new[] { typeof(string) });
        if (parse is null) return false;

        using Stream? stream = typeof(global::Jellyfin.Plugin.FranchiseExplorer.Plugin).Assembly.GetManifestResourceStream(ScriptResourceName);
        if (stream is null) throw new InvalidOperationException("Embedded home-tile JavaScript resource missing.");
        using var reader = new StreamReader(stream);
        string script = reader.ReadToEnd();

        string json = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["id"] = "jellyfin-franchise-explorer-my-media-v1",
            ["name"] = "Franchise Explorer - My Media tile",
            ["script"] = script,
            ["module"] = false,
            ["enabled"] = true,
            ["requiresAuthentication"] = false,
            ["pluginId"] = global::Jellyfin.Plugin.FranchiseExplorer.Plugin.PluginId.ToString(),
            ["pluginName"] = "Franchise Explorer",
            ["pluginVersion"] = "0.8.4.0"
        });

        object? payload = parse.Invoke(null, new object[] { json });
        if (payload is null) return false;
        object? result = register.Invoke(null, new[] { payload });
        return result is bool success && success;
    }
}

/// <summary>
/// Discovered by Jellyfin's DI container when the plugin is installed.
/// </summary>
public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection services, IServerApplicationHost applicationHost)
    {
        services.AddHostedService<HomeTileRegistrationService>();
        services.AddHostedService<TimelinePlaybackMonitorService>();
    }
}
