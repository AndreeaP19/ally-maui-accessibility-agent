using System.Globalization;
using System.Resources;
using Microsoft.Maui.Controls.Xaml;

namespace SampleApp.Resources.Localization;

[ContentProperty(nameof(Key))]
public class Localize : IMarkupExtension<string>
{
    private static readonly ResourceManager ResourceManager =
        new("SampleApp.Resources.Localization.AppResources", typeof(Localize).Assembly);

    public string Key { get; set; } = string.Empty;

    public string ProvideValue(IServiceProvider serviceProvider)
    {
        return ResourceManager.GetString(Key, CultureInfo.CurrentUICulture) ?? Key;
    }

    object IMarkupExtension.ProvideValue(IServiceProvider serviceProvider) => ProvideValue(serviceProvider);
}
