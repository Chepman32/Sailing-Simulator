#include "SailingTrial.h"

#include "CanvasItem.h"
#include "Engine/Canvas.h"
#include "Engine/Font.h"
#include "SailingExplorer.h"
#include "SailingPlayerController.h"

namespace
{
const FLinearColor Ink(.88, .95, .94), Muted(.55, .72, .73), Disabled(.35, .48, .49);
const FLinearColor Base(.015, .042, .051), Surface(.028, .075, .088), Raised(.042, .110, .124);
const FLinearColor LineInk(.085, .192, .209), Accent(.32, .91, .79), Amber(1., .64, .29);

struct FDeckPainter
{
    ASailingTrialHUD& Hud;
    UCanvas& Canvas;
    UFont& Font;
    UTexture2D* InventoryArt;
    FVector2D Mouse;

    void Rect(double X, double Y, double W, double H, FLinearColor Color) const
    {
        Hud.DrawRect(Color, X, Y, W, H);
    }

    void Line(FVector2D A, FVector2D B, FLinearColor Color, float Width = 1.f) const
    {
        Hud.DrawLine(A.X, A.Y, B.X, B.Y, Color, Width);
    }

    void Text(const FString& Value, double X, double Y, float Size = 16.f, FLinearColor Color = Ink, bool bBold = false) const
    {
        FCanvasTextItem Item({X, Y}, FText::FromString(Value), FSlateFontInfo(&Font, Size, bBold ? TEXT("Bold") : TEXT("Regular")), Color);
        Canvas.DrawItem(Item);
    }

    void Target(FName Id, double X, double Y, double W, double H) const
    {
        Hud.AddHitBox(FVector2D(X, Y) * Hud.InputScale(), FVector2D(W, H) * Hud.InputScale(), Id, true);
    }

    bool Hover(double X, double Y, double W, double H) const
    {
        return FBox2D({X, Y}, {X + W, Y + H}).IsInside(Mouse);
    }

    void Button(FName Id, const FString& Label, double X, double Y, double W, double H = 42.,
                bool bEnabled = true, bool bPrimary = false) const
    {
        const bool bHover = bEnabled && Hover(X, Y, W, H);
        const FLinearColor Fill = bPrimary && bEnabled ? (bHover ? FLinearColor(.46, .99, .88) : Accent)
            : bHover ? LineInk : Raised;
        Rect(X, Y, W, H, Fill);
        Text(Label, X + 14., Y + (H - 23.) * .5, 16., bEnabled ? (bPrimary ? Base : Ink) : Disabled, bPrimary);
        if (bEnabled) Target(Id, X, Y, W, H);
    }

    void GearImage(int32 Index, double X, double Y, double Size) const
    {
        if (InventoryArt)
        {
            constexpr float Inset = 10.f / 1536.f;
            Hud.DrawTexture(InventoryArt, X, Y, Size, Size, (Index % 3) / 3.f + Inset, (Index / 3) / 2.f,
                1.f / 3.f - 2.f * Inset, .5f, FLinearColor::White);
        }
    }
};

struct FGearText
{
    const TCHAR* Label;
    const TCHAR* Detail;
    const TCHAR* Action;
    FLinearColor Tint;
};

const FGearText Gear[] = {
    {TEXT("Air tank"), TEXT("Refills when you reach the surface."), TEXT(""), {.91, .73, .27}},
    {TEXT("Dive torch"), TEXT("Lights the reef and seabed."), TEXT("Switch on torch"), {.32, .88, .83}},
    {TEXT("Red flare"), TEXT("Red parachute signal for distress."), TEXT("Launch red flare"), {1., .39, .31}},
    {TEXT("Green flare"), TEXT("Green signal to mark your position."), TEXT("Launch green flare"), {.32, .93, .55}}
};
static_assert(UE_ARRAY_COUNT(Gear) == int32(ESailingGear::Count));

FString SlotStatus(ESailingGear Item, const ASailingPlayerController& Player, const USailingExplorer& Explorer)
{
    if (Item == ESailingGear::Tank) return FString::Printf(TEXT("%.0f%% air"), Explorer.AirFraction() * 100.f);
    if (Item == ESailingGear::Torch) return Explorer.TorchOn() ? TEXT("On") : TEXT("Off");
    if (Explorer.Away()) return TEXT("At the helm");
    return Player.CanUseGear(Item) ? TEXT("Ready") : TEXT("Cooling down");
}

void DrawGear(const FDeckPainter& Paint, const ASailingPlayerController& Player, const ASailingYachtPawn& Yacht, FVector2D Size)
{
    const auto& Explorer = Yacht.Explorer();
    const auto Selected = Player.SelectedGear();
    const auto& Entry = Gear[int32(Selected)];
    Paint.Rect(0, 0, Size.X, Size.Y, Base.CopyWithNewOpacity(.92f));
    Paint.Text(TEXT("Inventory"), 32, 22, 40, Ink, true);
    Paint.Text(FString::Printf(TEXT("%d coins"), Player.Coins()), 258, 47, 18, Amber, true);
    Paint.Button(TEXT("ChartPage"), TEXT("Map  ·  Q"), Size.X - 348, 25, 146);
    Paint.Button(TEXT("Close"), TEXT("Close  ·  Esc"), Size.X - 190, 25, 158);
    Paint.Line({32, 88}, {Size.X - 32, 88}, LineInk);

    const double Left = 32., Gap = 10., Cell = 166., GridWidth = 4 * Cell + 3 * Gap;
    const double First = 155., Second = First + Cell + 52.;
    Paint.Text(TEXT("Dive equipment"), Left, First - 37., 20, Ink, true);
    Paint.Text(TEXT("Signal flares"), Left, Second - 37., 20, Ink, true);
    const FLinearColor SlotInk(.051, .118, .135);
    const auto EmptySlot = [&](double X, double Y) {
        Paint.Rect(X, Y, Cell, Cell, SlotInk);
        Paint.Rect(X + 1, Y + 1, Cell - 2, Cell - 2, Base.CopyWithNewOpacity(.89f));
        Paint.Line({X + 12, Y + 22}, {X + 12, Y + 12}, LineInk);
        Paint.Line({X + 12, Y + 12}, {X + 22, Y + 12}, LineInk);
        Paint.Line({X + Cell - 12, Y + Cell - 22}, {X + Cell - 12, Y + Cell - 12}, LineInk);
        Paint.Line({X + Cell - 12, Y + Cell - 12}, {X + Cell - 22, Y + Cell - 12}, LineInk);
    };
    for (int32 Column = 2; Column < 4; ++Column)
    {
        const double X = Left + Column * (Cell + Gap);
        EmptySlot(X, First);
        EmptySlot(X, Second);
    }
    for (int32 Column = 0; Column < 4; ++Column)
        EmptySlot(Left + Column * (Cell + Gap), Second + Cell + Gap);

    for (int32 Index = 0; Index < UE_ARRAY_COUNT(Gear); ++Index)
    {
        const bool bDive = Index < int32(ESailingGear::RedFlare);
        const int32 Column = bDive ? Index : Index - int32(ESailingGear::RedFlare);
        const double X = Left + Column * (Cell + Gap), Y = bDive ? First : Second;
        const bool bSelected = Index == int32(Selected), bHover = Paint.Hover(X, Y, Cell, Cell);
        const FLinearColor Crown = Gear[Index].Tint;
        Paint.Rect(X, Y, Cell, Cell, bSelected ? Crown : bHover ? Muted : LineInk);
        const double Border = bSelected ? 2. : 1.;
        Paint.Rect(X + Border, Y + Border, Cell - 2 * Border, Cell - 2 * Border, FMath::Lerp(SlotInk, Crown, .14f));
        const double ArtSize = Cell - 44.;
        Paint.GearImage(Index, X + (Cell - ArtSize) * .5, Y + Border, ArtSize);
        Paint.Rect(X + Border, Y + Cell - 51., Cell - 2 * Border, 51. - Border, Base.CopyWithNewOpacity(.90f));
        Paint.Text(Gear[Index].Label, X + 11., Y + Cell - 49., 16., Ink, true);
        Paint.Text(SlotStatus(ESailingGear(Index), Player, Explorer), X + 11., Y + Cell - 25., 13., bSelected ? Crown : Muted);
        Paint.Target(FName(TEXT("GearEntry"), Index + 1), X, Y, Cell, Cell);
    }

    const double X = Left + GridWidth + 26., Y = 113., W = Size.X - X - 32.;
    Paint.Rect(X, Y, W, Size.Y - Y - 59., Surface);
    Paint.Rect(X, Y, W, 2., Entry.Tint);
    Paint.Text(Entry.Label, X + 25, Y + 22, 35, Ink, true);
    const double ImageSize = 207.;
    Paint.GearImage(int32(Selected), X + 25., Y + 81., ImageSize);
    Paint.Text(Selected == ESailingGear::Tank ? TEXT("Air remaining") : TEXT("Status"), X + 253., Y + 131., 15., Muted);
    const float Air = Explorer.AirFraction();
    const FLinearColor AirColor = Air < .22f ? Amber : Accent;
    const auto Readout = Selected == ESailingGear::Tank ? FString::Printf(TEXT("%.0f%%"), Air * 100.f)
        : SlotStatus(Selected, Player, Explorer);
    Paint.Text(Readout, X + 252., Y + 157., Selected == ESailingGear::Tank ? 40.f : 22.f,
        Selected == ESailingGear::Tank ? AirColor : Entry.Tint, true);
    Paint.Text(Entry.Detail, X + 25., Y + 310., 16., Muted);
    Paint.Line({X + 25., Y + 355.}, {X + W - 25., Y + 355.}, LineInk);
    if (Selected == ESailingGear::Tank)
    {
        const double Gauge = W - 50.;
        Paint.Rect(X + 25, Y + 382, Gauge, 8, Base);
        Paint.Rect(X + 25, Y + 382, Gauge * Air, 8, AirColor);
        const int32 Seconds = FMath::RoundToInt(Explorer.AirSecondsAtDepth());
        const bool bSubmerged = Explorer.DepthM() > .5f;
        Paint.Text(TEXT("Depth"), X + 25, Y + 421, 16, Muted);
        Paint.Text(FString::Printf(TEXT("%.1f m"), Explorer.DepthM()), X + 25, Y + 448, 26, Ink, true);
        Paint.Text(bSubmerged ? TEXT("Time at this depth") : TEXT("Tank status"), X + W * .50, Y + 421, 16, Muted);
        Paint.Text(bSubmerged ? FString::Printf(TEXT("%d:%02d"), Seconds / 60, Seconds % 60) :
                   (Air < .995f ? TEXT("Refilling") : TEXT("Full")), X + W * .50, Y + 448, 26, Ink, true);
        Paint.Text(TEXT("Hold Space to surface while swimming."), X + 25, Size.Y - 105, 16, Muted);
    }
    else
    {
        const bool bTorch = Selected == ESailingGear::Torch;
        const bool bReady = Player.CanUseGear();
        const FString Action = bTorch && Explorer.TorchOn() ? TEXT("Switch off torch") : Entry.Action;
        Paint.Button(TEXT("UseGear"), Action, X + 25, Y + 382, 228, 48, bReady, true);
        if (bTorch)
            Paint.Text(bReady ? TEXT("F toggles the torch while exploring.") : TEXT("Use the torch while walking or swimming."),
                X + 25, Y + 449, 16, Muted);
    }
    Paint.Text(TEXT("Arrow keys   Select     Enter   Use     Q   Map     Esc   Close"), 33, Size.Y - 38, 14, Muted);
}

void DrawChart(const FDeckPainter& Paint, const ASailingPlayerController& Player, const ASailingYachtPawn& Yacht, FVector2D Size)
{
    const FSailingChart& Chart = Player.ChartView();
    const FBox2D Area = FSailingChart::Plot(Size);
    Chart.Draw(Paint.Hud, Paint.Canvas, Paint.Font, Size, Yacht);
    Paint.Rect(0, 0, Size.X, Area.Min.Y, Base);
    Paint.Rect(0, Area.Min.Y, Area.Min.X, Area.GetSize().Y, Base);
    Paint.Rect(0, Area.Max.Y, Size.X, Size.Y - Area.Max.Y, Base);
    Paint.Rect(Area.Max.X, Area.Min.Y, Size.X - Area.Max.X, Area.GetSize().Y, Base);
    Paint.Text(TEXT("Map"), 32, 22, 40, Ink, true);
    Paint.Text(Yacht.HasCoralCoast() ? TEXT("Coral Pass") : TEXT("Sea trial"), 183, 47, 18, Muted);
    Paint.Button(TEXT("GearPage"), TEXT("Inventory  ·  Tab"), Size.X - 396, 25, 194);
    Paint.Button(TEXT("Close"), TEXT("Close  ·  Esc"), Size.X - 190, 25, 158);
    Paint.Line({32, 88}, {Size.X - 32, 88}, LineInk);

    const double X = Area.Max.X + 19., W = Size.X - X - 32., Y = Area.Min.Y;
    Paint.Rect(X, Y, W, Area.GetSize().Y, Surface);
    Paint.Text(TEXT("Navigation"), X + 16., Y + 15., 24, Ink, true);
    Paint.Text(FString::Printf(TEXT("%d coins"), Player.Coins()), X + W - 120, Y + 20, 16, Amber, true);
    Paint.Button(TEXT("Follow"), TEXT("Center on player  ·  R"), X + 16, Y + 57, W - 32, 39, true, Chart.bFollowing);
    Paint.Button(TEXT("FitChart"), TEXT("Fit all islands  ·  F"), X + 16, Y + 105, W - 32, 39, Chart.IslandCount() > 0);
    Paint.Button(TEXT("ZoomOut"), TEXT("Zoom out"), X + 16, Y + 153, (W - 41) * .5, 39);
    Paint.Button(TEXT("ZoomIn"), TEXT("Zoom in"), X + 25 + (W - 41) * .5, Y + 153, (W - 41) * .5, 39);
    Paint.Line({X + 16., Y + 213.}, {X + W - 16., Y + 213.}, LineInk);
    Paint.Text(TEXT("Waypoint"), X + 16., Y + 229., 20, Ink, true);
    if (Chart.HasWaypoint())
    {
        Paint.Text(Chart.WaypointLabel(), X + 16, Y + 261, 18, Amber, true);
        Paint.Text(Chart.WaypointReadout(Yacht), X + 16, Y + 292, 18, Ink);
        Paint.Button(TEXT("FastTravel"), TEXT("Fast travel  ·  10 coins"), X + 16, Y + 322, W - 32, 39,
            Chart.Arrival().IsSet() && Player.Coins() >= Player.TravelFare, true);
        Paint.Button(TEXT("ClearWaypoint"), TEXT("Clear waypoint  ·  Delete"), X + 16, Y + 369, W - 32, 33);
        Paint.Text(Chart.Arrival().IsSet() ? TEXT("Green ring marks arrival") : TEXT("No safe arrival nearby"), X + 16, Y + 410, 14, Muted);
    }
    else
    {
        Paint.Text(TEXT("Click a point on the map."), X + 16, Y + 267, 16, Muted);
        Paint.Text(TEXT("Its bearing will appear as you sail."), X + 16, Y + 294, 16, Muted);
    }
    Paint.Line({X + 16., Y + 445.}, {X + W - 16., Y + 445.}, LineInk);
    Paint.Text(TEXT("Legend"), X + 16, Y + 457, 20, Ink, true);
    struct FKeyedMark { const TCHAR* Label; FLinearColor Color; };
    const FKeyedMark Keys[] = {
        {TEXT("Yacht / player"), Ink}, {TEXT("Jet ski"), Accent}, {TEXT("Landmark / vessel"), FLinearColor(.97, .65, .31)},
        {TEXT("Shallows up to 2 m"), FLinearColor(.16, .47, .44)}, {TEXT("Sailed track"), FLinearColor(.27, .64, .69)}
    };
    for (int32 I = 0; I < UE_ARRAY_COUNT(Keys); ++I)
    {
        const double Row = Y + 490. + I * 26.;
        Paint.Rect(X + 17, Row + 6, 10, 10, Keys[I].Color);
        Paint.Text(Keys[I].Label, X + 39, Row, 16, Muted);
    }
    Paint.Text(TEXT("Drag   Pan     Scroll   Zoom     Click   Set waypoint     Enter   Set at map center"),
               32, Size.Y - 37, 14, Muted);
}
}

bool ASailingTrialHUD::DrawDeckPanel(const ASailingPlayerController& Player, const ASailingYachtPawn& Yacht, FVector2D Size)
{
    const ESailingPanel Panel = Player.GetPanel();
    if (Panel != ESailingPanel::Gear && Panel != ESailingPanel::Chart) return false;
    FVector2D Mouse(-1., -1.);
    Player.GetMousePosition(Mouse.X, Mouse.Y);
    const FDeckPainter Paint{*this, *Canvas, *HelmFont, InventoryArt, Mouse / InputScale()};
    if (Panel == ESailingPanel::Gear) DrawGear(Paint, Player, Yacht, Size);
    else DrawChart(Paint, Player, Yacht, Size);
    return true;
}
