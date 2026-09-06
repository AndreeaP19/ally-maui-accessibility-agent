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
}
