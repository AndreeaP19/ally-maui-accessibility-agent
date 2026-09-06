using SampleApp;

namespace SampleApp.Views;

public partial class LoginPage : ContentPage
{
    public LoginPage()
    {
        InitializeComponent();
    }

    private async void OnBackTapped(object sender, EventArgs e)
    {
        await Navigation.PopAsync();
    }

    private void OnLoginClicked(object sender, EventArgs e)
    {
        App.SetRootPage(new AppShell());
    }

    private void OnForgotPasswordTapped(object sender, EventArgs e)
    {
    }
}
