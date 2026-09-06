using SampleApp;

namespace SampleApp.Views;

public partial class MainPage : ContentPage
{
    public MainPage()
    {
        InitializeComponent();
    }

    private void OnLogoutClicked(object sender, EventArgs e)
    {
        App.SetRootPage(new NavigationPage(new LoginPage()));
    }
}
