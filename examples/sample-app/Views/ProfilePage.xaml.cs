namespace SampleApp.Views;

public partial class ProfilePage : ContentPage
{
    public ProfilePage()
    {
        InitializeComponent();
    }

    private async void OnManagePlanClicked(object sender, EventArgs e)
    {
        await DisplayAlertAsync("Manage Plan", "Plan management isn't available in this sample.", "OK");
    }

    private async void OnAvatarTapped(object sender, EventArgs e)
    {
        await DisplayAlertAsync("Change Photo", "Photo upload isn't available in this sample.", "OK");
    }
}
