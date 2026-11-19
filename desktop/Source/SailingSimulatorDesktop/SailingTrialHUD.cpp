#include "SailingTrial.h"

#include "Engine/Canvas.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/ScopeExit.h"
#include "SailingPlayerController.h"
#include "SailingWeather.h"
#include "SailingExplorer.h"
#include "SailingVoyageSound.h"

void ASailingTrialHUD::BeginPlay()
{
    Super::BeginPlay();
    Weather = Cast<ASailingWeather>(UGameplayStatics::GetActorOfClass(this, ASailingWeather::StaticClass()));
    if (FParse::Param(FCommandLine::Get(), TEXT("SailingHideHUD"))) bShowHUD = false;
}

double ASailingTrialHUD::ThrottleAt(double ScreenY) const
{
    return FMath::Clamp(1.0 - 2.0 * (ScreenY / UIScale - ThrottleTop) / ThrottleHeight, -1.0, 1.0);
}

void ASailingTrialHUD::DrawHUD()
{
    Super::DrawHUD();
    const ASailingYachtPawn* Yacht = Cast<ASailingYachtPawn>(GetOwningPawn());
    const ASailingPlayerController* Player = Cast<ASailingPlayerController>(GetOwningPlayerController());
    if (!Yacht || !Player || !Canvas || !Canvas->Canvas || Yacht->IsCinematic()) return;

    UIScale = FMath::Clamp(FMath::Min(Canvas->ClipX / 1440.f, Canvas->ClipY / 900.f), 1.f, 2.f);
    const float ScreenWidth = Canvas->ClipX / UIScale;
    const float ScreenHeight = Canvas->ClipY / UIScale;
    Canvas->Canvas->PushRelativeTransform(FScaleMatrix(FVector(UIScale, UIScale, 1)));
    ON_SCOPE_EXIT
    {
        Canvas->Canvas->PopTransform();
    };
    const auto Hit = [&](FName Name, FVector2D Position, FVector2D Size) {
        AddHitBox(Position * UIScale, Size * UIScale, Name, true);
    };

    const FLinearColor Panel(.008f, .023f, .029f, .86f);
    const FLinearColor Button(.026f, .083f, .096f, .94f);
    const FLinearColor Muted(.70f, .83f, .85f);
    const FLinearColor Accent(.26f, .89f, .77f);
    const auto DrawButton = [&](FName Name, const FString& Label, float X, float Y, float Width) {
        DrawRect(Button, X, Y, Width, 32);
        DrawText(Label, FLinearColor::White, X + 10, Y + 7);
        Hit(Name, {X, Y}, {Width, 32});
    };

    const ESailingPanel Open = Player->GetPanel();
    const USailingExplorer& Explorer = Yacht->Explorer();
    if (Open == ESailingPanel::Chart)
    {
        Player->ChartView().Draw(*this, *Canvas, {ScreenWidth, ScreenHeight}, *Yacht);
        DrawButton(TEXT("Close"), TEXT("Close"), ScreenWidth - 91, 14, 75);
        DrawButton(TEXT("Follow"), TEXT("Recenter"), ScreenWidth - 192, 14, 94);
        DrawButton(TEXT("ZoomOut"), TEXT("−"), ScreenWidth - 270, 14, 32);
        DrawButton(TEXT("ZoomIn"), TEXT("+"), ScreenWidth - 231, 14, 32);
        return;
    }
    if (Open == ESailingPanel::Gear)
    {
        const float X = (ScreenWidth - 320) * .5f, Y = (ScreenHeight - 205) * .5f;
        DrawRect(Panel, X, Y, 320, 205);
        DrawText(TEXT("Dive equipment"), FLinearColor::White, X + 16, Y + 16, nullptr, 1.5f);
        DrawText(FString::Printf(TEXT("Air tank     %.0f%%"), Explorer.AirFraction() * 100), Muted, X + 16, Y + 68);
        DrawText(Explorer.TorchOn() ? TEXT("Dive torch    On") : TEXT("Dive torch    Off"), Muted, X + 16, Y + 98);
        DrawButton(TEXT("Close"), TEXT("Close"), X + 16, Y + 150, 90);
        return;
    }
    if (Open != ESailingPanel::None)
    {
        const bool bHelp = Open == ESailingPanel::Controls;
        const float Width = FMath::Min(bHelp ? 495.f : 350.f, ScreenWidth - 16.f);
        const float Height = bHelp ? 464.f : 108.f;
        const float X = (ScreenWidth - Width) * .5f;
        const float Y = FMath::Max(4.f, (ScreenHeight - Height) * .5f);
        DrawRect(Panel, X, Y, Width, Height);
        DrawText(bHelp ? TEXT("Sailing controls") : TEXT("Paused"), FLinearColor::White, X + 16, Y + 12, nullptr, 1.5f);
        if (bHelp)
        {
            static const TCHAR* Rows[][2] = {
                {TEXT("W / S   or   ↑ / ↓"), TEXT("Ahead / astern throttle")},
                {TEXT("A / D   or   ← / →"), TEXT("Turn the helm")},
                {TEXT("Space   ·   C"), TEXT("Engine   ·   Center rudder")},
                {TEXT("Drag wheel / lever"), TEXT("Steer / set throttle")},
                {TEXT("Z / X   ·   Y"), TEXT("Ease / trim   ·   Auto trim")},
                {TEXT("V   ·   P"), TEXT("Cycle view   ·   Cinematic view")},
                {TEXT("Drag   ·   Wheel"), TEXT("Look around   ·   Zoom")},
                {TEXT("R   or   Double-click"), TEXT("Recenter view")},
                {TEXT("T   ·   E"), TEXT("Overboard / return   ·   Board / take helm")},
                {TEXT("WASD   ·   Shift"), TEXT("Walk / swim   ·   Run / swim faster")},
                {TEXT("Space   ·   C   ·   F"), TEXT("Jump / rise   ·   Crouch / dive   ·   Torch")},
                {TEXT("Q / N   ·   Tab"), TEXT("Chart   ·   Dive equipment")},
                {TEXT("J / B   ·   F / G"), TEXT("Horn / bell   ·   Red / green signal flare")},
                {TEXT("M   ·   O / Shift+O"), TEXT("Sound   ·   Next / previous radio station")},
                {TEXT("1–4   ·   L"), TEXT("Weather presets   ·   Squall lightning")},
                {TEXT("H   ·   Esc"), TEXT("Controls   ·   Close or pause")}};
            float RowY = Y + 54;
            for (const auto& Row : Rows)
            {
                DrawText(Row[0], Accent, X + 16, RowY);
                DrawText(Row[1], FLinearColor::White, X + 160, RowY);
                RowY += 22;
            }
        }
        DrawButton(TEXT("Close"), bHelp ? TEXT("Close") : TEXT("Resume"), X + 16, Y + Height - 46, 100);
        if (!bHelp) DrawButton(TEXT("Help"), TEXT("Controls"), X + 126, Y + Height - 46, 100);
        return;
    }

    const FString Notice = Player->NoticeText();
    if (!Notice.IsEmpty())
    {
        float Width, Height;
        GetTextSize(Notice, Width, Height);
        DrawRect(Panel, (ScreenWidth - Width) * .5f - 12, 15, Width + 24, 29);
        DrawText(Notice, FLinearColor::White, (ScreenWidth - Width) * .5f, 21);
    }
    if (Explorer.Away())
    {
        const TCHAR* Mode = TEXT("On deck");
        switch (Explorer.Mode())
        {
        case ESkipperMode::Leap:
            Mode = TEXT("Over the side");
            break;
        case ESkipperMode::Swim:
            Mode = Explorer.DepthM() > .5f ? TEXT("Diving") : TEXT("Swimming");
            break;
        case ESkipperMode::Shore:
            Mode = TEXT("Ashore");
            break;
        default:
            break;
        }
        DrawRect(Panel, 16, 16, 228, 78);
        DrawText(Mode, FLinearColor::White, 28, 23, nullptr, 1.5f);
        DrawText(
            FString::Printf(TEXT("Depth %.1f m   ·   Air %.0f%%"), Explorer.DepthM(), Explorer.AirFraction() * 100),
            Muted, 28, 66);
        DrawRect(Panel, 16, ScreenHeight - 55, 284, 39);
        DrawText(TEXT("T   Back to helm     Q   Chart     H   Controls"), Muted, 26, ScreenHeight - 43);
        if (const TCHAR* Prompt = Explorer.Prompt(*Yacht))
        {
            DrawRect(Panel, ScreenWidth * .5f - 78, ScreenHeight - 100, 156, 32);
            DrawText(Prompt, Accent, ScreenWidth * .5f - 62, ScreenHeight - 92);
        }
        return;
    }
    const Sailing::FHelm& Helm = Yacht->ReadHelm();
    const Sailing::FSail Sail = Yacht->ReadSail();
    const double Heading = FMath::Fmod(Yacht->GetActorRotation().Yaw + 360.0, 360.0);
    const double Speed = Yacht->GetVelocity().Size2D() * .01 * Sailing::KnotsPerMps;
    DrawRect(Panel, 16, 16, 250, 95);
    DrawText(Weather ? Weather->ConditionName() : TEXT("Sea trial"), Muted, 28, 23);
    DrawText(FString::Printf(TEXT("%.1f kn     %03.0f°"), Speed, Heading), FLinearColor::White, 27, 40, nullptr, 1.8f);
    DrawText(FString::Printf(TEXT("AW %.1f kn  %+.0f°     %s %.0f°"), Sail.ApparentSpeedMps * Sailing::KnotsPerMps,
                             FMath::RadiansToDegrees(Sail.ApparentAngleRad),
                             Helm.bAutoTrim ? TEXT("Auto") : TEXT("Sheet"),
                             FMath::RadiansToDegrees(Sail.SheetAngleRad)),
             Muted, 28, 84);
    DrawButton(TEXT("View"), FString::Printf(TEXT("V   %s"), Yacht->ViewName()), ScreenWidth - 122, 16, 106);
    DrawButton(TEXT("Help"), TEXT("H   Controls"), ScreenWidth - 122, 52, 106);
    DrawButton(TEXT("Chart"), TEXT("Q   Chart"), ScreenWidth - 122, 88, 106);
    DrawButton(TEXT("Overboard"), TEXT("T   Overboard"), ScreenWidth - 122, 124, 106);
    DrawButton(TEXT("Sound"), Player->Sound().Enabled() ? TEXT("M   Sound on") : TEXT("M   Sound off"),
               ScreenWidth - 122, 160, 106);
    DrawButton(TEXT("Radio"), TEXT("O   Radio"), ScreenWidth - 122, 196, 106);
    if (Player->Sound().Station() >= 0) DrawText(Player->Sound().StationLabel(), Muted, 18, 120);
    const float SignalsX = (ScreenWidth - 312) * .5f;
    DrawButton(TEXT("Horn"), TEXT("J   Horn"), SignalsX, ScreenHeight - 49, 70);
    DrawButton(TEXT("Bell"), TEXT("B   Bell"), SignalsX + 74, ScreenHeight - 49, 68);
    DrawButton(TEXT("Red"), TEXT("F   Red flare"), SignalsX + 146, ScreenHeight - 49, 86);
    DrawButton(TEXT("Green"), TEXT("G   Green flare"), SignalsX + 236, ScreenHeight - 49, 100);

    const float HelmY = ScreenHeight - 87;
    DrawRect(Panel, 16, HelmY, 212, 71);
    const FVector2D Center(53, HelmY + 35);
    const auto Rim = [&Center](double Angle) { return Center + FVector2D(FMath::Sin(Angle), -FMath::Cos(Angle)) * 23; };
    for (int32 I = 0; I < 24; ++I)
    {
        const FVector2D A = Rim(I * UE_DOUBLE_TWO_PI / 24);
        const FVector2D B = Rim((I + 1) * UE_DOUBLE_TWO_PI / 24);
        DrawLine(A.X, A.Y, B.X, B.Y, Muted, 2);
    }
    for (int32 I = 0; I < 3; ++I)
    {
        const FVector2D Tip = Rim(Helm.Rudder * 1.5 * UE_DOUBLE_PI + I * UE_DOUBLE_TWO_PI / 3);
        DrawLine(Center.X, Center.Y, Tip.X, Tip.Y, I == 0 ? Accent : Muted, 3);
    }
    DrawText(FString::Printf(TEXT("Rudder   %+.0f°"), Helm.Rudder * Sailing::MaxRudderDegrees), FLinearColor::White, 91,
             HelmY + 12);
    DrawButton(TEXT("Center"), TEXT("Center"), 82, HelmY + 34, 100);
    Hit(TEXT("Rudder"), {16, HelmY}, {212, 71});

    const float LeverX = ScreenWidth - 128;
    const float LeverY = ScreenHeight - 179;
    DrawRect(Panel, LeverX, LeverY, 112, 163);
    DrawText(TEXT("Throttle"), Muted, LeverX + 12, LeverY + 7);
    ThrottleTop = LeverY + 34;
    ThrottleHeight = 66;
    const float TrackX = LeverX + 28;
    DrawLine(TrackX, ThrottleTop, TrackX, ThrottleTop + ThrottleHeight, Muted, 2);
    DrawLine(TrackX - 7, ThrottleTop + 33, TrackX + 7, ThrottleTop + 33, Muted, 1);
    const float Lever = ThrottleTop + (1.f - Helm.Throttle) * .5f * ThrottleHeight;
    DrawRect(Helm.bEngineOn ? Accent : Muted, TrackX - 10, Lever - 3, 20, 6);
    DrawText(FString::Printf(TEXT("%+.0f%%"), Helm.Throttle * 100), FLinearColor::White, LeverX + 51, LeverY + 55);
    Hit(TEXT("Throttle"), {LeverX, ThrottleTop - 8}, {112, ThrottleHeight + 16});
    DrawButton(TEXT("Engine"), Helm.bEngineOn ? TEXT("Engine on") : TEXT("Engine off"), LeverX + 8, LeverY + 122, 96);
}
