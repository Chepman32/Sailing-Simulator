#include "SailingTrial.h"

#include "Engine/Canvas.h"
#include "Engine/Texture2D.h"
#include "CanvasItem.h"
#include "Engine/Font.h"
#include "UObject/ConstructorHelpers.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/ScopeExit.h"
#include "SailingPlayerController.h"
#include "SailingWeather.h"
#include "SailingExplorer.h"
#include "SailingVoyageSound.h"

namespace
{
enum class ETile { World, View, Chart, Help, Sound, Radio, Overboard, Horn, Bell, Flare, Engine, Wind, Sheet,
                   Card=16, Button, Key, Emergency, Running, Stopped, Handle, Track };

struct FHelmPainter
{
    ASailingTrialHUD& Hud;
    UCanvas& Canvas;
    UTexture2D* Atlas;
    UFont* Font;

    void Slice(ETile Id, float X, float Y, float W, float H, float U, float V, float UW, float VH,
               FLinearColor Tint=FLinearColor::White) const
    {
        const int I = int(Id);
        Hud.DrawTexture(Atlas,X,Y,W,H,(I%8+U)/8,(I/8+V)/4,UW/8,VH/4,Tint);
    }
    void Icon(ETile Id, float X, float Y, float Size, FLinearColor Tint=FLinearColor::White) const
    {
        Slice(Id,X,Y,Size,Size,0,0,1,1,Tint);
    }
    void Box(ETile Id, float X, float Y, float W, float H, float Corner=12) const
    {
        const float R=FMath::Min3(Corner,W*.5f,H*.5f);
        const float Left[]={0,R,W-R,W}, Top[]={0,R,H-R,H};
        constexpr float UV[]={0,.25f,.75f,1};
        for (int Row=0; Row<3; ++Row)
            for (int Col=0; Col<3; ++Col)
                Slice(Id,X+Left[Col],Y+Top[Row],Left[Col+1]-Left[Col],Top[Row+1]-Top[Row],
                      UV[Col],UV[Row],UV[Col+1]-UV[Col],UV[Row+1]-UV[Row]);
    }
    void Label(const FString& Text, float X, float Y, float Size, FLinearColor Color=FLinearColor::White,
               bool Bold=false) const
    {
        FCanvasTextItem Item({X,Y}, FText::FromString(Text),
            FSlateFontInfo(Font, Size, Bold ? TEXT("Bold") : TEXT("Regular")), Color);
        Canvas.DrawItem(Item);
    }
};
}

ASailingTrialHUD::ASailingTrialHUD()
{
    static ConstructorHelpers::FObjectFinder<UTexture2D> Art(TEXT("/Game/Coastal/Interface/HelmAtlas"));
    static ConstructorHelpers::FObjectFinder<UFont> Typeface(TEXT("/Engine/EngineFonts/Roboto"));
    HelmAtlas = Art.Object;
    HelmFont = Typeface.Object;
}

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

    UIScale = FMath::Min(Canvas->ClipX / 1305.f, Canvas->ClipY / 816.f);
    if (UIScale <= 0.f) return;
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

    const FLinearColor Muted(.70f, .83f, .85f);
    const FLinearColor Accent(.26f, .89f, .77f);
    const FHelmPainter Paint{*this,*Canvas,HelmAtlas,HelmFont};
    const auto DrawButton = [&](FName Name, const FString& Label, float X, float Y, float Width) {
        Paint.Box(ETile::Button, X, Y, Width, 32);
        Paint.Label(Label, X+10, Y+6, 12);
        Hit(Name, {X, Y}, {Width, 32});
    };

    const ESailingPanel Open = Player->GetPanel();
    const USailingExplorer& Explorer = Yacht->Explorer();
    if (Open==ESailingPanel::World) return;
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
        Paint.Box(ETile::Card, X, Y, 320, 205);
        Paint.Label(TEXT("Dive equipment"), X+16, Y+14, 18, FLinearColor::White, true);
        Paint.Label(FString::Printf(TEXT("Air tank     %.0f%%"), Explorer.AirFraction()*100), X+16, Y+65, 13, Muted);
        Paint.Label(Explorer.TorchOn() ? TEXT("Dive torch    On") : TEXT("Dive torch    Off"), X+16, Y+95, 13, Muted);
        DrawButton(TEXT("Close"), TEXT("Close"), X + 16, Y + 150, 90);
        return;
    }
    if (Open != ESailingPanel::None)
    {
        const bool bHelp = Open == ESailingPanel::Controls;
        const float Width = FMath::Min(bHelp ? 560.f : 350.f, ScreenWidth - 16.f);
        const float Height = bHelp ? 464.f : 108.f;
        const float X = (ScreenWidth - Width) * .5f;
        const float Y = FMath::Max(4.f, (ScreenHeight - Height) * .5f);
        Paint.Box(ETile::Card, X, Y, Width, Height);
        Paint.Label(bHelp ? TEXT("Sailing controls") : TEXT("Paused"), X+16, Y+10, 18, FLinearColor::White, true);
        if (bHelp)
        {
            static const TCHAR* Rows[][2] = {
                {TEXT("W / S   or   ↑ / ↓"), TEXT("Ahead / astern throttle")},
                {TEXT("A / D   or   ← / →"), TEXT("Turn the helm")},
                {TEXT("Space   ·   C"), TEXT("Engine   ·   Center rudder")},
                {TEXT("Drag throttle lever"), TEXT("Set engine power")},
                {TEXT("Z / X   ·   Y"), TEXT("Ease / trim   ·   Auto trim")},
                {TEXT("V   ·   P"), TEXT("Cycle view   ·   Cinematic view")},
                {TEXT("Drag   ·   Wheel"), TEXT("Look around   ·   Zoom")},
                {TEXT("R   or   Double-click"), TEXT("Recenter view")},
                {TEXT("T   ·   E"), TEXT("Overboard / return   ·   Board / take helm")},
                {TEXT("WASD   ·   Shift"), TEXT("Walk / swim   ·   Run / swim faster")},
                {TEXT("Space   ·   C   ·   F"), TEXT("Jump / rise   ·   Crouch / dive   ·   Torch")},
                {TEXT("Q / N   ·   Tab"), TEXT("Chart   ·   Dive equipment")},
                {TEXT("J / B   ·   F / G"), TEXT("Horn / bell   ·   Red / green signal flare")},
                {TEXT("M   ·   O or 0 / Shift+O"), TEXT("Sound   ·   Next / previous radio station")},
                {TEXT("1–4   ·   L"), TEXT("Weather presets   ·   Squall lightning")},
                {TEXT(",   ·   H   ·   Esc"), TEXT("World controls   ·   Help   ·   Close or pause")}};
            float RowY = Y + 54;
            for (const auto& Row : Rows)
            {
                Paint.Label(Row[0], X+16, RowY, 11, Accent);
                Paint.Label(Row[1], X+178, RowY, 11);
                RowY += 22;
            }
        }
        DrawButton(TEXT("Close"), bHelp ? TEXT("Close") : TEXT("Resume"), X + 16, Y + Height - 46, 100);
        if (!bHelp) DrawButton(TEXT("Help"), TEXT("Controls"), X + 126, Y + Height - 46, 100);
        if (!bHelp) DrawButton(TEXT("World"), TEXT("World"), X + 234, Y + Height - 46, 96);
        return;
    }

    const FString Notice = Player->NoticeText();
    if (!Notice.IsEmpty())
    {
        float Width, Height;
        GetTextSize(Notice, Width, Height);
        Paint.Box(ETile::Card, (ScreenWidth - Width) * .5f - 12, 145, Width + 24, 29);
        DrawText(Notice, FLinearColor::White, (ScreenWidth - Width) * .5f, 151);
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
        Paint.Box(ETile::Card, 16, 16, 228, 78);
        Paint.Label(Mode, 28, 22, 18, FLinearColor::White, true);
        Paint.Label(FString::Printf(TEXT("Depth %.1f m   ·   Air %.0f%%"), Explorer.DepthM(), Explorer.AirFraction()*100),
            28, 60, 13, Muted);
        Paint.Box(ETile::Card, 16, ScreenHeight - 55, 388, 39);
        Paint.Label(TEXT("T   Back to helm     Q   Chart     ,   World     H   Controls"), 29, ScreenHeight-46, 11, Muted);
        if (const TCHAR* Prompt = Explorer.Prompt(*Yacht))
        {
            Paint.Box(ETile::Card, ScreenWidth * .5f - 78, ScreenHeight - 100, 156, 32);
            Paint.Label(Prompt, ScreenWidth*.5f-62, ScreenHeight-94, 11, Accent);
        }
        return;
    }
    const Sailing::FHelm& Helm = Yacht->ReadHelm();
    const Sailing::FSail Sail = Yacht->ReadSail();
    const double Heading = FMath::Fmod(Yacht->GetActorRotation().Yaw + 360.0, 360.0);
    const double Speed = Yacht->GetVelocity().Size2D() * .01 * Sailing::KnotsPerMps;
    const FLinearColor Silver(.74f,.81f,.85f), Amber(1.f,.58f,.18f);
    Paint.Box(ETile::Card,18,15,330,119,19);
    Paint.Label(Weather ? Weather->ConditionName() : TEXT("Sea trial"),35,24,15,Silver);
    Paint.Label(FString::Printf(TEXT("%.1f kn"),Speed),35,48,28,Amber,true);
    Paint.Label(FString::Printf(TEXT("%03d°"),FMath::RoundToInt(Heading)%360),205,48,28,FLinearColor::White,true);
    DrawRect(Silver.CopyWithNewOpacity(.45f),174,58,1,30);
    Paint.Icon(ETile::Wind,35,101,20,Silver);
    Paint.Label(FString::Printf(TEXT("AW %.1f kn %+.0f°"),Sail.ApparentSpeedMps*Sailing::KnotsPerMps,
        FMath::RadiansToDegrees(Sail.ApparentAngleRad)),60,98,13,Silver);
    DrawRect(Silver.CopyWithNewOpacity(.45f),211,102,1,20);
    Paint.Icon(ETile::Sheet,226,101,17,Silver);
    Paint.Label(FString::Printf(TEXT("%s %.0f°"),Helm.bAutoTrim ? TEXT("Auto") : TEXT("Sheet"),
        FMath::RadiansToDegrees(Sail.SheetAngleRad)),249,98,13,Silver);

    float MouseX=-1, MouseY=-1;
    Player->GetMousePosition(MouseX,MouseY);
    FVector2D Mouse(MouseX,MouseY);
    Mouse /= UIScale;
    const auto Action = [&](const TCHAR* Name, ETile Glyph, const FString& Text, const TCHAR* Key,
                            float X,float Y,float W,float H,ETile Style=ETile::Button,
                            FLinearColor Ink=FLinearColor::White, bool bCompact=false)
    {
        const bool Hover = FBox2D(FVector2D(X,Y),FVector2D(X+W,Y+H)).IsInside(Mouse);
        const float Corner = bCompact ? 10 : 14;
        Paint.Box(Style,X,Y,W,H,Corner);
        if (Hover) Paint.Box(ETile::Key,X+2,Y+2,W-4,H-4,Corner-2);
        const bool Motor=Glyph==ETile::Engine;
        const float IconSize=bCompact ? 19 : Motor ? 31 : 24;
        Paint.Icon(Glyph,X+(bCompact ? 9 : 14),Y+(H-IconSize)*.5f,IconSize,Ink);
        Paint.Label(Text,X+IconSize+(bCompact ? 15 : 24),Y+(H-(bCompact ? 21 : 24))*.5f-1,
            bCompact ? 12 : Motor ? 16 : 14);
        if (Key && *Key)
        {
            const float KeySize=bCompact ? 21 : 25;
            const float KeyX=X+W-KeySize-(bCompact ? 8 : 11);
            Paint.Box(ETile::Key,KeyX,Y+(H-KeySize-1)*.5f,KeySize,KeySize+1,bCompact ? 5 : 7);
            Paint.Label(Key,KeyX+(bCompact ? 4 : 6),Y+(H-(bCompact ? 19 : 23))*.5f,bCompact ? 11 : 13);
        }
        Hit(Name,{X,Y},{W,H});
    };
    const float Right = ScreenWidth-8;
    float ActionRight = Right;
    const auto TopAction = [&](const TCHAR* Name, ETile Glyph, const TCHAR* Label, const TCHAR* Key,
                               float Width, ETile Style=ETile::Button) {
        Action(Name,Glyph,Label,Key,ActionRight-Width,15,Width,38,Style,FLinearColor::White,true);
        ActionRight -= Width+7;
    };
    TopAction(TEXT("Overboard"),ETile::Overboard,TEXT("Overboard"),TEXT("T"),153,ETile::Emergency);
    TopAction(TEXT("Radio"),ETile::Radio,TEXT("Radio"),TEXT("0"),113);
    TopAction(TEXT("Sound"),ETile::Sound,Player->Sound().Enabled() ? TEXT("Sound on") : TEXT("Sound off"),TEXT("M"),136);
    TopAction(TEXT("Help"),ETile::Help,TEXT("Controls"),TEXT("H"),135);
    TopAction(TEXT("Chart"),ETile::Chart,TEXT("Chart"),TEXT("Q"),112);
    TopAction(TEXT("View"),ETile::View,Yacht->ViewName(),TEXT("V"),116);
    TopAction(TEXT("World"),ETile::World,TEXT("World"),nullptr,92);
    if (Player->Sound().Station() >= 0) Paint.Label(Player->Sound().StationLabel(),22,139,13);

    const float Bottom=ScreenHeight-26, LeverX=Right-224;
    const float SignalY=Bottom-52;
    Action(TEXT("Horn"),ETile::Horn,TEXT("Horn"),TEXT("J"),LeverX-746,SignalY,154,52);
    Action(TEXT("Bell"),ETile::Bell,TEXT("Bell"),TEXT("B"),LeverX-583,SignalY,145,52);
    DrawRect(Silver.CopyWithNewOpacity(.65f),LeverX-424,SignalY+10,1,32);
    Action(TEXT("Red"),ETile::Flare,TEXT("Red flare"),TEXT("F"),LeverX-409,SignalY,184,52,
           ETile::Button,FLinearColor(1.f,.16f,.13f));
    Action(TEXT("Green"),ETile::Flare,TEXT("Green flare"),TEXT("G"),LeverX-216,SignalY,197,52,
           ETile::Button,FLinearColor(.19f,1.f,.34f));

    const float LeverY=FMath::Max(164.f,ScreenHeight*.333f);
    Paint.Box(ETile::Card,LeverX,LeverY,224,Bottom-LeverY,19);
    Paint.Label(TEXT("Throttle"),LeverX+17,LeverY+13,17);
    ThrottleTop=LeverY+66;
    ThrottleHeight=Bottom-98-ThrottleTop;
    const float Axis=LeverX+112;
    Paint.Box(ETile::Track,Axis-17,ThrottleTop,34,ThrottleHeight,8);
    DrawRect(FLinearColor(.86f,.93f,.95f,.94f),Axis-3,ThrottleTop+2,6,ThrottleHeight-4);
    const float Lever=ThrottleTop+(1.f-Helm.Throttle)*.5f*ThrottleHeight;
    Paint.Box(ETile::Handle,Axis-27,Lever-10,54,21,9);
    Hit(TEXT("Throttle"),{Axis-38,ThrottleTop-10},{76,ThrottleHeight+20});
    Action(TEXT("Engine"),ETile::Engine,Helm.bEngineOn ? TEXT("Engine on") : TEXT("Engine off"),nullptr,
           LeverX+15,Bottom-67,194,54,Helm.bEngineOn ? ETile::Running : ETile::Stopped);
}
