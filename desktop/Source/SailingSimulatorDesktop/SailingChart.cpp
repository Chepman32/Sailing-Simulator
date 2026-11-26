#include "SailingChart.h"
#include "SailingJetSki.h"

#include "CanvasItem.h"
#include "Engine/Canvas.h"
#include "Engine/StaticMeshActor.h"
#include "EngineUtils.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/HUD.h"
#include "Rendering/SlateRenderer.h"
#include "SailingExplorer.h"
#include "SailingTrial.h"

namespace
{
FVector2D OnPaper(FVector2D World)
{
    return {World.Y, -World.X};
}
FVector2D FromPaper(FVector2D Paper)
{
    return {-Paper.Y, Paper.X};
}
} // namespace

void FSailingChart::Open(UWorld& World, const ASailingYachtPawn& Yacht)
{
    if (!bSurveyed || bFollowing) Recenter(Yacht);
    if (bSurveyed) return;
    bSurveyed = true;
    // Sample the placed collision triangles at mean sea level. Editor labels
    // are stripped in Shipping; mesh identity and transforms survive cooking.
    for (TActorIterator<AStaticMeshActor> It(&World); It; ++It)
    {
        UStaticMeshComponent* Mesh = It->GetStaticMeshComponent();
        if (!Mesh || !Mesh->GetStaticMesh()) continue;
        FString Name = Mesh->GetStaticMesh()->GetName();
        Name.RemoveFromStart(TEXT("SM_"));
        const FVector2D Origin = FVector2D(Mesh->GetComponentLocation()) * .01;
        const bool bLight = Name == TEXT("LightStation") || Name == TEXT("Lighthouse");
        if (It->ActorHasTag(TEXT("SailingPirate")))
        {
            Marks.Add({TEXT("Pirate ship"), Origin});
            continue;
        }
        if (bLight || It->ActorHasTag(TEXT("SailingMerchant")))
        {
            const TCHAR* Label = bLight ? TEXT("Coral Pass Light")
                : Name == TEXT("ProductTanker") ? TEXT("Product tanker")
                : Name == TEXT("GasCarrier") ? TEXT("LNG carrier")
                : Name == TEXT("ContainerShip") ? TEXT("Container ship") : TEXT("Anchorage");
            Marks.Add({Label, Origin});
            continue;
        }
        if (!Name.EndsWith(TEXT("Cay")) && Name != TEXT("CloudHead") && Name != TEXT("Volcano")) continue;
        FIsland Island{
            Name.Replace(TEXT("Cay"), TEXT(" Cay")).Replace(TEXT("CloudHead"), TEXT("Cloud Head")), Origin, {}, {}};
        constexpr int32 Bearings = 64;
        const double RangeM = Mesh->Bounds.SphereRadius * .012;
        const double TraceTop = Mesh->Bounds.Origin.Z + Mesh->Bounds.BoxExtent.Z + 100;
        const FCollisionQueryParams Query(SCENE_QUERY_STAT(SailingChartCoast), true);
        for (int32 I = 0; I < Bearings; ++I)
        {
            const double Theta = UE_DOUBLE_TWO_PI * I / Bearings;
            const FVector2D Bearing(FMath::Cos(Theta), FMath::Sin(Theta));
            const auto AtDepth = [&](double FloorCm)
            {
                double Inner = 0, Outer = RangeM;
                for (int32 Step = 0; Step < 10; ++Step)
                {
                    const double Radius = (Inner + Outer) * .5;
                    const FVector2D XY = (Origin + Bearing * Radius) * 100.;
                    FHitResult Hit;
                    if (Mesh->LineTraceComponent(Hit, FVector(XY, TraceTop), FVector(XY, FloorCm), Query))
                        Inner = Radius;
                    else Outer = Radius;
                }
                return Origin + Bearing * Inner;
            };
            Island.Coast.Add(AtDepth(0.));
            Island.Shoal.Add(AtDepth(-200.));
        }
        Land.Add(MoveTemp(Island));
    }
}

FBox2D FSailingChart::Plot(FVector2D Size)
{
    return FBox2D({32., 106.}, {Size.X - 369., Size.Y - 54.});
}

FVector2D FSailingChart::WorldAt(FVector2D Cursor, const FBox2D& Area) const
{
    return Center + FromPaper(Cursor - Area.GetCenter()) * MetersPerPixel;
}

void FSailingChart::Track(FVector YachtPosition)
{
    const FVector2D Point = FVector2D(YachtPosition) * .01;
    if (!Trail.IsEmpty() && FVector2D::DistSquared(Point, Trail.Last()) < 64) return;
    if (Trail.Num() == 512) Trail.RemoveAt(0, 1, EAllowShrinking::No);
    Trail.Add(Point);
}

void FSailingChart::Recenter(const ASailingYachtPawn& Yacht)
{
    Center = FVector2D(Yacht.WorldFocus()) * .01;
    bFollowing = true;
}

void FSailingChart::Fit(FVector2D PlotSize, const ASailingYachtPawn& Yacht)
{
    FBox2D Bounds(ForceInit);
    Bounds += FVector2D(Yacht.WorldFocus()) * .01;
    for (const FIsland& Island : Land)
        for (const FVector2D Point : Island.Shoal) Bounds += Point;
    for (const FMark& Mark : Marks) Bounds += Mark.Position;
    if (Bounds.GetSize().IsNearlyZero()) return;
    const FVector2D Span = Bounds.GetSize();
    Center = Bounds.GetCenter();
    MetersPerPixel = FMath::Clamp(FMath::Max(Span.Y / (PlotSize.X * .84), Span.X / (PlotSize.Y * .84)), .1, 25.);
    bFollowing = false;
}

void FSailingChart::Pan(FVector2D Pixels)
{
    if (Pixels.IsNearlyZero()) return;
    Center -= FromPaper(Pixels) * MetersPerPixel;
    bFollowing = false;
}

void FSailingChart::Zoom(double Wheel, FVector2D Offset)
{
    const double Before = MetersPerPixel;
    MetersPerPixel = FMath::Clamp(Before * FMath::Pow(.80, Wheel), .1, 25.);
    if (!Offset.IsNearlyZero() && Before != MetersPerPixel)
    {
        Center += FromPaper(Offset) * (Before - MetersPerPixel);
        bFollowing = false;
    }
}

void FSailingChart::SetWaypoint(FVector2D PositionM, const ASailingYachtPawn& Yacht)
{
    double Best = FMath::Square(14. * MetersPerPixel);
    Waypoint = PositionM;
    WaypointName = TEXT("Custom waypoint");
    const auto Consider = [&](FVector2D Place, const FString& Label) {
        const double Distance = FVector2D::DistSquared(PositionM, Place);
        if (Distance >= Best) return;
        Best = Distance;
        Waypoint = Place;
        WaypointName = Label;
    };
    for (const FMark& Mark : Marks) Consider(Mark.Position, Mark.Name);
    for (const ASailingJetSki* Ski : Yacht.JetSkis())
        if (IsValid(Ski)) Consider(FVector2D(Ski->GetActorLocation()) * .01, TEXT("Jet ski"));
}

FString FSailingChart::WaypointReadout(const ASailingYachtPawn& Yacht) const
{
    if (!Waypoint.IsSet()) return {};
    const FVector2D Offset = Waypoint.GetValue() - FVector2D(Yacht.WorldFocus()) * .01;
    const double Distance = Offset.Size();
    const int32 Bearing = FMath::RoundToInt(FMath::RadiansToDegrees(FMath::Atan2(Offset.Y, Offset.X)) + 360.) % 360;
    const FString Range = Distance >= 1000. ? FString::Printf(TEXT("%.1f km"), Distance * .001) :
        FString::Printf(TEXT("%.0f m"), Distance);
    return Distance < 8. ? TEXT("At waypoint") : FString::Printf(TEXT("%s   /   %03d°"), *Range, Bearing);
}

void FSailingChart::Draw(AHUD& HUD, UCanvas& Canvas, UFont& Font, FVector2D Size, const ASailingYachtPawn& Yacht) const
{
    const FBox2D Area = Plot(Size);
    const FVector2D Middle = Area.GetCenter();
    const auto XY = [&](FVector2D Point) { return Middle + OnPaper(Point - Center) / MetersPerPixel; };
    const auto Line = [&](FVector2D A, FVector2D B, FLinearColor Ink, float Thick = 1) {
        HUD.DrawLine(A.X, A.Y, B.X, B.Y, Ink, Thick);
    };
    const auto Text = [&](const FString& Value, FVector2D At, FLinearColor Ink, float TextSize = 13, bool bBold = false) {
        FCanvasTextItem Item(At, FText::FromString(Value), FSlateFontInfo(&Font, TextSize, bBold ? TEXT("Bold") : TEXT("Regular")), Ink);
        Canvas.DrawItem(Item);
    };
    const auto Diamond = [&](FVector2D P, double Radius, FLinearColor Ink, float Thick) {
        const FVector2D Top(P.X, P.Y - Radius), Right(P.X + Radius, P.Y), Bottom(P.X, P.Y + Radius), Left(P.X - Radius, P.Y);
        Line(Top, Right, Ink, Thick);
        Line(Right, Bottom, Ink, Thick);
        Line(Bottom, Left, Ink, Thick);
        Line(Left, Top, Ink, Thick);
    };
    const FLinearColor Ink(.79, .92, .90), Grid(.055, .19, .22), TrackInk(.27, .64, .69);
    const FLinearColor Surf(.18, .47, .44), LandInk(.49, .58, .40), Landmark(.97, .65, .31), SkiInk(.31, .94, .87);
    const FLinearColor RouteInk(1., .64, .29);
    const FLinearColor LabelBase(.023, .085, .107, .92);
    HUD.DrawRect(FLinearColor(.020, .112, .151), 0, 0, Size.X, Size.Y);
    double GridM = 5000.;
    for (double Step : {10., 25., 50., 100., 250., 500., 1000., 2000., 5000.})
        if (Step / MetersPerPixel >= 80.) { GridM = Step; break; }
    const double Spacing = GridM / MetersPerPixel;
    const FVector2D Zero = XY(FVector2D::ZeroVector);
    for (double X = Zero.X + FMath::CeilToDouble((Area.Min.X - Zero.X) / Spacing) * Spacing; X < Area.Max.X; X += Spacing)
        Line({X, Area.Min.Y}, {X, Area.Max.Y}, Grid);
    for (double Y = Zero.Y + FMath::CeilToDouble((Area.Min.Y - Zero.Y) / Spacing) * Spacing; Y < Area.Max.Y; Y += Spacing)
        Line({Area.Min.X, Y}, {Area.Max.X, Y}, Grid);
    TArray<FCanvasUVTri> Faces;
    const auto Fill = [&](const FIsland& Island, const TArray<FVector2D>& Coast, FLinearColor Color)
    {
        const FVector2D Origin = XY(Island.Center);
        for (int32 I = 0; I < Coast.Num(); ++I)
        {
            FCanvasUVTri Face{};
            Face.V0_Pos = Origin;
            Face.V1_Pos = XY(Coast[I]);
            Face.V2_Pos = XY(Coast[(I + 1) % Coast.Num()]);
            Face.V0_Color = Face.V1_Color = Face.V2_Color = Color;
            Faces.Add(Face);
        }
    };
    for (const FIsland& Island : Land) Fill(Island, Island.Shoal, FLinearColor(.078, .284, .31));
    for (const FIsland& Island : Land) Fill(Island, Island.Coast, LandInk);
    Canvas.K2_DrawTriangle(nullptr, MoveTemp(Faces));
    for (const FIsland& Island : Land)
    {
        for (int32 I = 0; I < Island.Coast.Num(); ++I)
        {
            const int32 Next = (I + 1) % Island.Coast.Num();
            Line(XY(Island.Shoal[I]), XY(Island.Shoal[Next]), Surf);
            Line(XY(Island.Coast[I]), XY(Island.Coast[Next]), FLinearColor(.80, .79, .60), 1.4f);
        }
    }
    for (int32 I = 1; I < Trail.Num(); ++I) Line(XY(Trail[I - 1]), XY(Trail[I]), TrackInk, 1.7f);
    if (!bFollowing)
    {
        const FLinearColor Reticle(.29, .51, .54);
        Line(Middle - FVector2D(7, 0), Middle + FVector2D(7, 0), Reticle);
        Line(Middle - FVector2D(0, 7), Middle + FVector2D(0, 7), Reticle);
    }
    for (const FMark& Mark : Marks)
    {
        const FVector2D Pos = XY(Mark.Position);
        if (!Area.IsInside(Pos)) continue;
        HUD.DrawRect(Landmark, Pos.X - 3, Pos.Y - 3, 6, 6);
    }
    for (const ASailingJetSki* Ski : Yacht.JetSkis())
    {
        if (!IsValid(Ski)) continue;
        const FVector2D Pos = XY(FVector2D(Ski->GetActorLocation()) * .01);
        if (!Area.IsInside(Pos)) continue;
        Diamond(Pos, 4., SkiInk, 1.5f);
    }
    const FVector2D Focus = XY(FVector2D(Yacht.WorldFocus()) * .01);
    if (Waypoint.IsSet())
    {
        const FVector2D Pos = XY(Waypoint.GetValue());
        const FVector2D Direction = (Pos - Focus).GetSafeNormal();
        const double Length = (Pos - Focus).Size();
        for (double Offset = 12.; Offset < FMath::Min(Length - 13., 2000.); Offset += 14.)
            Line(Focus + Direction * Offset, Focus + Direction * FMath::Min(Offset + 6., Length - 13.), RouteInk, 1.1f);
        if (Area.IsInside(Pos)) Diamond(Pos, 8., RouteInk, 2.2f);
    }
    const FVector2D Boat = XY(FVector2D(Yacht.GetActorLocation()) * .01);
    const FVector2D Forward = OnPaper(FVector2D(Yacht.GetActorForwardVector()).GetSafeNormal());
    const FVector2D Right(-Forward.Y, Forward.X);
    const FVector2D Bow = Boat + Forward * 11, A = Boat - Forward * 7 + Right * 6, B = Boat - Forward * 7 - Right * 6;
    Line(A, Bow, FLinearColor::White, 2);
    Line(Bow, B, FLinearColor::White, 2);
    Line(B, A, FLinearColor::White, 2);
    if (Yacht.Explorer().Away() && Area.IsInside(Focus))
    {
        Diamond(Focus, 8., FLinearColor::White, 1.8f);
        HUD.DrawRect(FLinearColor::White, Focus.X - 2, Focus.Y - 2, 4, 4);
    }
    const FVector2D North = Area.Min + FVector2D(42, 42);
    HUD.DrawRect(FLinearColor(.026, .105, .135, .91), North.X - 24, North.Y - 24, 48, 74);
    Text(TEXT("N"), North - FVector2D(5, 19), Ink, 15, true);
    Line(North, North + FVector2D(-7, 12), Ink, 1.6f);
    Line(North, North + FVector2D(7, 12), Ink, 1.6f);
    Line(North, North + FVector2D(0, 31), Ink, 1.6f);
    const double Bar = GridM / MetersPerPixel;
    const FVector2D Scale(Area.Min.X + 24., Area.Max.Y - 26.);
    HUD.DrawRect(FLinearColor(.026, .105, .135, .92), Scale.X - 12, Scale.Y - 28, Bar + 24, 42);
    Line(Scale, Scale + FVector2D(Bar, 0.), Ink, 1.8f);
    Line(Scale - FVector2D(0, 4), Scale + FVector2D(0, 4), Ink);
    Line(Scale + FVector2D(Bar, -4), Scale + FVector2D(Bar, 4), Ink);
    Text(GridM >= 1000. ? FString::Printf(TEXT("%.0f km"), GridM / 1000.) : FString::Printf(TEXT("%.0f m"), GridM),
         Scale - FVector2D(0., 23.), Ink, 13);

    TArray<FBox2D, TInlineAllocator<40>> Occupied;
    Occupied.Emplace(North - FVector2D(24, 24), North + FVector2D(24, 50));
    Occupied.Emplace(Scale - FVector2D(12, 28), Scale + FVector2D(Bar + 12, 14));
    const auto Reserve = [&](FVector2D Pos, double Radius)
    {
        if (Area.IsInside(Pos)) Occupied.Emplace(Pos - FVector2D(Radius), Pos + FVector2D(Radius));
    };
    Reserve(Boat, 12.);
    Reserve(Focus, 9.);
    if (Waypoint.IsSet()) Reserve(XY(Waypoint.GetValue()), 9.);
    for (const FMark& Mark : Marks) Reserve(XY(Mark.Position), 5.);
    for (const ASailingJetSki* Ski : Yacht.JetSkis())
        if (IsValid(Ski)) Reserve(XY(FVector2D(Ski->GetActorLocation()) * .01), 6.);

    const auto Measure = FSlateApplication::Get().GetRenderer()->GetFontMeasureService();
    const auto Label = [&](const FString& Name, FVector2D Point, FLinearColor Color, bool bIsland)
    {
        if (!Area.IsInside(Point)) return;
        const FSlateFontInfo Typeface(&Font, bIsland ? 14 : 13, bIsland ? TEXT("Bold") : TEXT("Regular"));
        const FVector2D Pad(5, 1);
        const FVector2D Dim = FVector2D(Measure->Measure(Name, Typeface)) + Pad * 2.;
        const FVector2D Choices[] = {
            {-Dim.X * .5, -Dim.Y * .5},
            {12, -Dim.Y * .5}, {-Dim.X - 12, -Dim.Y * .5},
            {-Dim.X * .5, 12}, {-Dim.X * .5, -Dim.Y - 12}
        };
        for (int32 I = bIsland ? 0 : 1; I < UE_ARRAY_COUNT(Choices); ++I)
        {
            const FVector2D Top = Point + Choices[I];
            const FBox2D Box(Top, Top + Dim);
            if (!Area.IsInside(Box.Min) || !Area.IsInside(Box.Max)) continue;
            if (Occupied.ContainsByPredicate([&](const FBox2D& Other) { return Other.Intersect(Box); })) continue;
            HUD.DrawRect(LabelBase, Top.X, Top.Y, Dim.X, Dim.Y);
            FCanvasTextItem Item(Top + Pad, FText::FromString(Name), Typeface, Color);
            Canvas.DrawItem(Item);
            Occupied.Add(Box.ExpandBy(3.));
            return;
        }
    };
    if (Waypoint.IsSet()) Label(WaypointName, XY(Waypoint.GetValue()), RouteInk, false);
    for (const FIsland& Island : Land) Label(Island.Name, XY(Island.Center), Ink, true);
    for (const FMark& Mark : Marks)
        if (!Waypoint.IsSet() || Mark.Position != Waypoint.GetValue()) Label(Mark.Name, XY(Mark.Position), Ink, false);
    if (MetersPerPixel < 1.4)
        for (const ASailingJetSki* Ski : Yacht.JetSkis())
            if (IsValid(Ski) && (!Waypoint.IsSet() || FVector2D(Ski->GetActorLocation()) * .01 != Waypoint.GetValue()))
                Label(TEXT("Jet ski"), XY(FVector2D(Ski->GetActorLocation()) * .01), SkiInk, false);
}
