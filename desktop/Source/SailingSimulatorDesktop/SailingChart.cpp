#include "SailingChart.h"

#include "Engine/Canvas.h"
#include "Engine/StaticMeshActor.h"
#include "EngineUtils.h"
#include "GameFramework/HUD.h"
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
    Recenter(Yacht);
    if (bSurveyed) return;
    bSurveyed = true;
    ChartTitle = World.GetMapName().EndsWith(TEXT("CoralPass")) ? TEXT("Coral Pass  /  N ↑") : TEXT("Sea chart  /  N ↑");
    // Sample the placed collision triangles at mean sea level. Editor labels
    // are stripped in Shipping; mesh identity and transforms survive cooking.
    for (TActorIterator<AStaticMeshActor> It(&World); It; ++It)
    {
        UStaticMeshComponent* Mesh = It->GetStaticMeshComponent();
        if (!Mesh || !Mesh->GetStaticMesh()) continue;
        FString Name = Mesh->GetStaticMesh()->GetName();
        Name.RemoveFromStart(TEXT("SM_"));
        const FVector2D Origin = FVector2D(Mesh->GetComponentLocation()) * .01;
        if (Name == TEXT("Lighthouse") || Name == TEXT("ContainerShip"))
        {
            Marks.Add({Name == TEXT("Lighthouse") ? TEXT("Coral Pass Light") : TEXT("Anchorage"), Origin});
            continue;
        }
        if (!Name.EndsWith(TEXT("Cay")) && Name != TEXT("CloudHead") && Name != TEXT("Volcano")) continue;
        FIsland Island{
            Name.Replace(TEXT("Cay"), TEXT(" Cay")).Replace(TEXT("CloudHead"), TEXT("Cloud Head")), Origin, {}};
        constexpr int32 Bearings = 48;
        const double RangeM = Mesh->Bounds.SphereRadius * .012;
        const double TraceTop = Mesh->Bounds.Origin.Z + Mesh->Bounds.BoxExtent.Z + 100;
        const FCollisionQueryParams Query(SCENE_QUERY_STAT(SailingChartCoast), true);
        for (int32 I = 0; I < Bearings; ++I)
        {
            const double Theta = UE_DOUBLE_TWO_PI * I / Bearings;
            const FVector2D Bearing(FMath::Cos(Theta), FMath::Sin(Theta));
            double Inner = 0, Outer = RangeM;
            for (int32 Step = 0; Step < 9; ++Step)
            {
                const double R = (Inner + Outer) * .5;
                const FVector2D XY = (Origin + Bearing * R) * 100;
                FHitResult Hit;
                if (Mesh->LineTraceComponent(Hit, FVector(XY, TraceTop), FVector(XY, 0), Query))
                    Inner = R;
                else
                    Outer = R;
            }
            Island.Coast.Add(Origin + Bearing * Inner);
        }
        Land.Add(MoveTemp(Island));
    }
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

void FSailingChart::Draw(AHUD& HUD, UCanvas& Canvas, FVector2D Size, const ASailingYachtPawn& Yacht) const
{
    const FVector2D Middle = Size * .5;
    const auto XY = [&](FVector2D Point) { return Middle + OnPaper(Point - Center) / MetersPerPixel; };
    const auto Line = [&](FVector2D A, FVector2D B, FLinearColor Ink, float Thick = 1) {
        HUD.DrawLine(A.X, A.Y, B.X, B.Y, Ink, Thick);
    };
    const FLinearColor Ink(.78, .91, .88), Grid(.10, .27, .32), TrackInk(.31, .74, .78);
    HUD.DrawRect(FLinearColor(.025, .105, .15), 0, 0, Size.X, Size.Y);
    const double GridM = MetersPerPixel < .45 ? 25 : MetersPerPixel < 1.6 ? 100 : MetersPerPixel < 6 ? 500 : 2000;
    const double Spacing = GridM / MetersPerPixel;
    const FVector2D Zero = XY(FVector2D::ZeroVector);
    for (double X = FMath::Fmod(Zero.X, Spacing); X < Size.X; X += Spacing)
        Line({X, 0}, {X, Size.Y}, Grid);
    for (double Y = FMath::Fmod(Zero.Y, Spacing); Y < Size.Y; Y += Spacing)
        Line({0, Y}, {Size.X, Y}, Grid);
    TArray<FCanvasUVTri> Faces;
    for (const FIsland& Island : Land)
    {
        const FVector2D Origin = XY(Island.Center);
        for (int32 I = 0; I < Island.Coast.Num(); ++I)
        {
            FCanvasUVTri Face{};
            Face.V0_Pos = Origin;
            Face.V1_Pos = XY(Island.Coast[I]);
            Face.V2_Pos = XY(Island.Coast[(I + 1) % Island.Coast.Num()]);
            Face.V0_Color = Face.V1_Color = Face.V2_Color = FLinearColor(.32, .49, .32);
            Faces.Add(Face);
        }
    }
    Canvas.K2_DrawTriangle(nullptr, MoveTemp(Faces));
    for (const FIsland& Island : Land)
    {
        for (int32 I = 0; I < Island.Coast.Num(); ++I)
            Line(XY(Island.Coast[I]), XY(Island.Coast[(I + 1) % Island.Coast.Num()]), FLinearColor(.79, .77, .49),
                 1.5f);
        const FVector2D Label = XY(Island.Center);
        if (Island.Name != TEXT("Light Cay"))
            HUD.DrawText(Island.Name, FLinearColor(.026f, .075f, .049f), Label.X - 18, Label.Y - 6);
    }
    for (const FMark& Mark : Marks)
    {
        const FVector2D Pos = XY(Mark.Position);
        HUD.DrawRect(FLinearColor(.98, .71, .27), Pos.X - 2, Pos.Y - 2, 5, 5);
        HUD.DrawText(Mark.Name, Ink, Pos.X + 7, Pos.Y + 3);
    }
    for (int32 I = 1; I < Trail.Num(); ++I)
        Line(XY(Trail[I - 1]), XY(Trail[I]), TrackInk, 2);
    const FVector2D Boat = XY(FVector2D(Yacht.GetActorLocation()) * .01);
    const FVector2D Forward = OnPaper(FVector2D(Yacht.GetActorForwardVector()).GetSafeNormal());
    const FVector2D Right(-Forward.Y, Forward.X);
    const FVector2D Bow = Boat + Forward * 11, A = Boat - Forward * 7 + Right * 6, B = Boat - Forward * 7 - Right * 6;
    Line(A, Bow, FLinearColor::White, 2);
    Line(Bow, B, FLinearColor::White, 2);
    Line(B, A, FLinearColor::White, 2);
    if (Yacht.Explorer().Away())
    {
        const FVector2D Person = XY(FVector2D(Yacht.WorldFocus()) * .01);
        HUD.DrawRect(FLinearColor(.95, .64, .21), Person.X - 3, Person.Y - 3, 6, 6);
    }
    HUD.DrawText(ChartTitle, Ink, 20, 16, nullptr, 1.4f);
    const double Bar = GridM / MetersPerPixel;
    Line({22, Size.Y - 27}, {22 + Bar, Size.Y - 27}, Ink, 2);
    HUD.DrawText(FString::Printf(TEXT("%.0f m"), GridM), Ink, 22, Size.Y - 49);
}
