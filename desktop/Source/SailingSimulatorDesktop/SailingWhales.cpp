#include "SailingWhales.h"
#include "Components/PrimitiveComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "SailingEntryBubbles.h"
#include "SailingPlayerController.h"
#include "SailingTrial.h"
#include "SailingVoyageSound.h"
#include "SailingWeather.h"

namespace
{
constexpr double GravityCmS2 = 981.;
constexpr double RunUpS = 4.8, DiveS = 3.5;
constexpr double DeepApproachS = 2.3;
constexpr double ViewLeadS = RunUpS - DeepApproachS + .9;
constexpr double BreachViewOuter = .925, BreachViewInner = .979;
constexpr double ShoreStandOffM = 50.;
const FVector MassCentre(110., 0., -130.);
const FVector ContactPoints[] = {
    {550., 0., -175.}, {105., -178., -135.}, {105., 178., -135.},
    {125., 0., -263.}, {30., 0., -3.}, {-430., 0., -155.},
};

double WaterAt(const ASailingYachtPawn& Yacht, FVector Point)
{
    return 100. * Yacht.RenderedSurfaceHeightM(FVector2D(Point)*.01);
}

void PoseBreach(UStaticMeshComponent& Body, FVector Centre, FRotator Rotation)
{
    Body.SetWorldLocationAndRotation(Centre - Rotation.RotateVector(MassCentre), Rotation);
}
}

ASailingWhales::ASailingWhales()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PostPhysics;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Whales")));
    Visitor = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("SurfacingWhale"));
    Breacher = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("DistantWhale"));
    NearBubbles = CreateDefaultSubobject<USailingEntryBubbles>(TEXT("NearWhaleBubbles"));
    FarBubbles = CreateDefaultSubobject<USailingEntryBubbles>(TEXT("FarWhaleBubbles"));
    NearBubbles->SetupAttachment(GetRootComponent());
    FarBubbles->SetupAttachment(GetRootComponent());
    for (UStaticMeshComponent* Body : {Visitor.Get(), Breacher.Get()})
    {
        Body->SetupAttachment(GetRootComponent());
        Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Body->SetVisibility(false);
    }
}

void ASailingWhales::BeginPlay()
{
    Super::BeginPlay();
    Visitor->SetStaticMesh(WhaleMesh);
    Breacher->SetStaticMesh(WhaleMesh);
    Weather = Cast<ASailingWeather>(UGameplayStatics::GetActorOfClass(this,ASailingWeather::StaticClass()));
    const double Now = GetWorld()->GetTimeSeconds();
    Near.Next = Now + 2.;
    Far.Next = Now + 22. + DeepApproachS;
}

bool ASailingWhales::FindLane(const ASailingYachtPawn& Yacht, bool bBreach, FVector& Site, FVector& Course) const
{
    const auto* Shore = Yacht.ShoreGeometry();
    const auto Bounds = WhaleMesh->GetBounds();
    const FVector Pivot = bBreach ? MassCentre : FVector::ZeroVector;
    const double BodyRadiusM = (Bounds.SphereRadius + (Bounds.Origin - Pivot).Size() + 95.) * .01;
    const double LaneHalfSpanCm = bBreach ? 4000. : 3400.;
    const FVector Bow = Yacht.GetActorForwardVector().GetSafeNormal2D();
    FVector Eye = Yacht.GetActorLocation() + FVector(0, 0, 450.);
    FVector Ahead = Bow;
    double ViewSide = -1.;
    const auto* Player = Cast<APlayerController>(Yacht.GetController());
    const bool bYachtView = Player && Player->GetViewTarget() == &Yacht;
    if (bYachtView)
    {
        FRotator View;
        Player->GetPlayerViewPoint(Eye, View);
        Ahead = View.Vector().GetSafeNormal2D();
        if (Ahead.IsNearlyZero()) Ahead = Bow;
        if (bBreach)
        {
            // Lead the chase camera through the turn while the whale is still deep.
            const auto* Hull = CastChecked<UPrimitiveComponent>(Yacht.GetRootComponent());
            const double Turn = FMath::Clamp(FMath::RadiansToDegrees(Hull->GetPhysicsAngularVelocityInRadians().Z)
                * ViewLeadS, -48., 48.);
            if (Turn > 6.) ViewSide = 1.;
            Ahead = Ahead.RotateAngleAxis(Turn, FVector::UpVector);
            const FVector Boat = Yacht.GetActorLocation();
            Eye = Boat + (Eye - Boat).RotateAngleAxis(Turn, FVector::UpVector);
        }
    }
    const FCollisionQueryParams Query(SCENE_QUERY_STAT(WhalePass), true, &Yacht);
    const double JumpRanges[] = {17400., 15100., 20700., 23200., 24700.};
    const double SwimRanges[] = {9400., 11200.};
    const auto Ranges = bBreach ? MakeArrayView(JumpRanges) : MakeArrayView(SwimRanges);
    const double Direction = bBreach && BreachRandom.FRand() < .5f ? -1. : 1.;
    const FVector YachtXY(Yacht.GetActorLocation().X, Yacht.GetActorLocation().Y, 0.);
    for (double Bearing : {17.*ViewSide, -18.*ViewSide, 25.*ViewSide, -26.*ViewSide, 0., -42., 44., -70., 76., 125., -125., 180.})
    for (double Range : Ranges)
    {
        const FVector Ray = Ahead.RotateAngleAxis(Bearing, FVector::UpVector);
        const FVector Middle = YachtXY + Ray*Range;
        if (bBreach && bYachtView)
        {
            // Reserve room beside the yacht's sails and inside the edge of the view.
            const double Alignment = FVector::DotProduct((Middle - Eye).GetSafeNormal2D(), Ahead);
            if (Alignment < BreachViewOuter || Alignment > BreachViewInner) continue;
        }
        FVector Across = FVector::CrossProduct(FVector::UpVector, Ray)*Direction;
        if (Shore && !Shore->CorridorClear(FVector2D(Middle - Across * LaneHalfSpanCm) * .01,
                                          FVector2D(Middle + Across * LaneHalfSpanCm) * .01,
                                          ShoreStandOffM + BodyRadiusM)) continue;
        const FVector Depth(0, 0, -580.);
        const FVector Start = Middle - Across*3450. + Depth, End = Middle + Across*3450. + Depth;
        if (GetWorld()->SweepTestByChannel(Start, End, FQuat::Identity, ECC_Visibility,
            FCollisionShape::MakeBox(FVector(520., 520., 1100.)), Query)) continue;
        const FVector Target(Middle.X, Middle.Y, WaterAt(Yacht, Middle) + (bBreach ? 420. : 75.));
        if (GetWorld()->LineTraceTestByChannel(Eye, Target, ECC_Visibility, Query)) continue;
        if (bBreach)
        {
            // Only the approach needs the full depth. The landing stays near the surface.
            const auto RunUpBlocked = [&](const FVector& Heading) {
                const FVector Deep = Middle - Heading*1600. - FVector(0, 0, 1950.);
                return GetWorld()->SweepTestByChannel(Deep, Middle - FVector(0, 0, 290.), FQuat::Identity,
                    ECC_Visibility, FCollisionShape::MakeBox(FVector(480., 480., 650.)), Query);
            };
            if (RunUpBlocked(Across))
            {
                Across *= -1.;
                if (RunUpBlocked(Across)) continue;
            }
        }
        Site = Middle;
        Course = Across;
        return true;
    }
    return false;
}

void ASailingWhales::Swim(ASailingYachtPawn& Yacht, float Dt)
{
    FPass& Pass = Near;
    const double Now = GetWorld()->GetTimeSeconds();
    if (Pass.Age < 0)
    {
        if (Now < Pass.Next) return;
        Pass.Next = Now + 3.;
        FVector Middle;
        if (!FindLane(Yacht, false, Middle, Pass.Direction)) return;
        Pass.Start = Middle - Pass.Direction*3400.;
        Pass.Age = 0.;
        Pass.bBlew = Pass.bDived = Pass.bShowedBack = false;
        Pass.LastFlukeClearance = -1000.;
        Visitor->SetVisibility(true);
    }
    Pass.Age += Dt;
    constexpr double Duration = 23.;
    const double U = FMath::Min(1.,Pass.Age/Duration);
    FVector P = Pass.Start + Pass.Direction*(U*6800.);
    const FVector Side = FVector::CrossProduct(FVector::UpVector,Pass.Direction);
    const auto Surface = [&Yacht](FVector Point) { return 100.*Yacht.SurfaceHeightM(FVector2D(Point)*.01); };
    // The mesh origin is at the highest part of its back. Sample the swell over
    // the animal's length and beam so a steep face cannot lift the belly clear.
    const double Fore = Surface(P+Pass.Direction*580.), Aft = Surface(P-Pass.Direction*580.);
    const double Port = Surface(P-Side*155.), Starboard = Surface(P+Side*155.);
    const double Water = Surface(P);
    const double Rise = FMath::SmoothStep(0.,.31,U);
    const double Arch = FMath::SmoothStep(.48,.72,U)*(1.-FMath::SmoothStep(.77,.97,U));
    const double Dive = FMath::SmoothStep(.73,1.,U);
    const double Pitch = FMath::Clamp(FMath::RadiansToDegrees(FMath::Atan2(Fore-Aft,1160.)),-15.,15.)
        + 4.*Rise*(1.-FMath::SmoothStep(.29,.48,U)) - 20.*Arch;
    const double Roll = FMath::Clamp(FMath::RadiansToDegrees(FMath::Atan2(Port-Starboard,310.)),-10.,10.)
        - 3.*Arch;
    const FRotator Rotation(Pitch,Pass.Direction.Rotation().Yaw,Roll);
    P.Z = (.5*Water+.25*(Fore+Aft)) + FMath::Lerp(-1050., 57., Rise)
        - 65.*FMath::SmoothStep(.57,.73,U) - 1100.*Dive;
    // At the head, trunk and peduncle keep actual submerged sections in the
    // water. The last two metres of flukes may clear it during a sounding dive.
    const FVector Stations[] = {{580,0,-210},{-470,0,-160},{100,-135,-185},{100,135,-185}};
    for (const FVector& Local : Stations)
    {
        const FVector Offset=Rotation.RotateVector(Local);
        P.Z=FMath::Min(P.Z,Surface(P+Offset)-Offset.Z-65.);
    }
    Visitor->SetWorldLocationAndRotation(P,Rotation);
    const FVector Blowhole=P+Rotation.RotateVector(FVector(412.,0.,-9.));
    const FVector Back=P+Rotation.RotateVector(FVector(-190.,0.,-14.));
    FVector Fluke=P+Rotation.RotateVector(FVector(-855.,0.,-182.));
    // The tail stroke is authored in world Z in the whale material's second UV.
    constexpr double TailUV=.975;
    Fluke.Z+=95.*TailUV*TailUV*TailUV*FMath::Sin(Now*1.75-TailUV*3.);
    const double AtHead=Surface(Blowhole), AtBack=Surface(Back), AtTail=Surface(Fluke);
    const double TailClearance=Fluke.Z-AtTail;
    Pass.bShowedBack |= Back.Z>AtBack || Blowhole.Z>AtHead;
    const auto Contact = [&](FVector Point, double Waterline, bool bBlow, float Strength)
    {
        Point.Z=Waterline;
        Yacht.WhaleContact(Point,Strength,false);
        if (Weather) Weather->WhaleSpray(Point*.01,Pass.Direction,Yacht.SeaFrame(),bBlow,Strength);
        NearBubbles->Splash(Yacht,Point-Pass.Direction*145.,Pass.Direction,650.*Strength,bBlow ? 1.8f : 3.2f);
    };
    if (!Pass.bBlew && U<.58 && Blowhole.Z>=AtHead+2.)
    {
        Contact(Blowhole,AtHead,true,.27f);
        Pass.bBlew=true;
    }
    const bool TailEntry=Pass.LastFlukeClearance>0 && TailClearance<=0;
    const bool BackSubmerged=U>.79 && Fluke.Z<AtTail && Back.Z<AtBack;
    if (!Pass.bDived && Pass.bShowedBack && U>.61 && (TailEntry || BackSubmerged))
    {
        const double EntryMps=.01*(Pass.LastFlukeClearance-TailClearance)/FMath::Max(.001f,Dt);
        const float Strength=TailEntry ? .52f+.43f*FMath::SmoothStep(.35,2.8,EntryMps) : .51f;
        Contact(TailEntry ? Fluke : Back,TailEntry ? AtTail : AtBack,false,Strength);
        Pass.bDived=true;
    }
    Pass.LastFlukeClearance=TailClearance;
    if (U >= 1.)
    {
        Visitor->SetVisibility(false);
        Pass.Age = -1;
        Pass.Next = Now + FMath::FRandRange(29.f,44.f);
    }
}

void ASailingWhales::Jump(ASailingYachtPawn& Yacht, float Dt)
{
    const double Now = GetWorld()->GetTimeSeconds();
    if (Far.Age < 0.)
    {
        if (Now < Far.Next) return;
        Far.Next = Now + 3.;
        if (!FindLane(Yacht, true, Far.Launch, Far.Course)) return;
        const double ExitPitch = FMath::DegreesToRadians(BreachRandom.FRandRange(53.f, 59.f));
        const double ExitSpeed = BreachRandom.FRandRange(1030.f, 1130.f);
        Far.RiseSpeed = ExitSpeed * FMath::Sin(ExitPitch);
        Far.ForwardSpeed = ExitSpeed * FMath::Cos(ExitPitch);
        Far.Roll = BreachRandom.FRandRange(62.f, 104.f) * (BreachRandom.FRand() < .5f ? -1. : 1.);
        Far.Next = Now + BreachRandom.FRandRange(33.f, 56.f);
        Far.Age = DeepApproachS;
        Far.LandedAt = -1.;
        Far.bLaunched = false;
        Breacher->SetVisibility(true);
    }

    Far.Age += Dt;
    const double Yaw = Far.Course.Rotation().Yaw;
    const double UpPitch = FMath::RadiansToDegrees(FMath::Atan2(Far.RiseSpeed, Far.ForwardSpeed));
    if (Far.Age < RunUpS)
    {
        const double Remaining = RunUpS - Far.Age;
        const double Ramp = Remaining / RunUpS;
        FVector Centre = Far.Launch - Far.Course * (Far.ForwardSpeed * Remaining * (1. - .27*Ramp));
        Centre.Z = WaterAt(Yacht, Far.Launch) - Far.RiseSpeed * Remaining * (1. - .33*Ramp);
        PoseBreach(*Breacher, Centre, FRotator(UpPitch, Yaw, .14*Far.Roll * FMath::Square(1. - Ramp)));
        return;
    }
    if (Far.LandedAt >= 0.)
    {
        const double DiveAge = Far.Age - Far.LandedAt;
        constexpr double WaterDrag = 1.35;
        const double Travel = (1. - FMath::Exp(-WaterDrag * DiveAge)) / WaterDrag;
        const double Turn = FMath::SmoothStep(0., DiveS*.78, DiveAge);
        FVector Centre = Far.ImpactCentre + Far.Course*(Far.ForwardSpeed * Travel);
        Centre.Z -= Far.DescentSpeed * Travel + 470.*FMath::SmoothStep(0., DiveS, DiveAge);
        PoseBreach(*Breacher, Centre, FRotator(FMath::Lerp(Far.ImpactRotation.Pitch, -36., Turn), Yaw,
            FMath::Lerp(Far.ImpactRotation.Roll, 0., Turn)));
        if (DiveAge >= DiveS)
        {
            Breacher->SetVisibility(false);
            Far.Age = -1.;
        }
        return;
    }

    if (!Far.bLaunched)
    {
        Far.Launch.Z = WaterAt(Yacht, Far.Launch);
        Far.bLaunched = true;
        if (Weather) Weather->BreachSpray(Yacht, Far.Launch*.01, Far.Course, false, .5f);
    }
    const double AirTime = Far.Age - RunUpS;
    const double ApexTime = Far.RiseSpeed / GravityCmS2;
    const double RollIn = FMath::SmoothStep(.06, 1.9*ApexTime, AirTime);
    FVector Centre = Far.Launch + Far.Course*(Far.ForwardSpeed * AirTime);
    Centre.Z += (Far.RiseSpeed - .5*GravityCmS2 * AirTime) * AirTime;
    const FRotator Rotation(FMath::Lerp(UpPitch, -12., RollIn), Yaw, FMath::Lerp(.14, 1., RollIn)*Far.Roll);
    PoseBreach(*Breacher, Centre, Rotation);
    if (AirTime < ApexTime) return;

    // Use the first descending part of the trunk to meet a rendered wave.
    // A fixed flight duration would make the splash float over troughs.
    const auto Pose = Breacher->GetComponentTransform();
    FVector Contact;
    double Lowest = TNumericLimits<double>::Max();
    for (const FVector& Local : ContactPoints)
    {
        const FVector Point = Pose.TransformPosition(Local);
        const double Water = WaterAt(Yacht, Point);
        const double Clearance = Point.Z - Water;
        if (Clearance >= Lowest) continue;
        Lowest = Clearance;
        Contact = {Point.X, Point.Y, Water};
    }
    if (Lowest <= 0.) Land(Yacht, Contact, Centre, Rotation, GravityCmS2 * AirTime - Far.RiseSpeed);
}

void ASailingWhales::Land(ASailingYachtPawn& Yacht, FVector Contact, FVector Centre, FRotator Rotation, double DescentSpeed)
{
    Far.LandedAt = Far.Age;
    Far.ImpactCentre = Centre;
    Far.ImpactRotation = Rotation;
    Far.DescentSpeed = DescentSpeed;
    const auto Frame = Yacht.SeaFrame();
    const double WaveSpeed = Sailing::SampleSea(FVector2D(Contact)*.01, Frame.TimeS, 0., Frame.Scale,
        Yacht.HasCoralCoast()).VelocityMps.Z;
    const float Force = FMath::SmoothStep(2.5, 8.2, DescentSpeed*.01 + WaveSpeed);
    Yacht.WhaleContact(Contact, 1.25f + .34f*Force, true);
    if (Weather) Weather->BreachSpray(Yacht, Contact*.01, Far.Course, true, Force);
    FarBubbles->Splash(Yacht, Contact - Far.Course*350., Far.Course, 650.f + 260.f*Force, 5.f);
    if (auto* Player = Cast<ASailingPlayerController>(Yacht.GetController()))
        Player->Sound().WhaleImpact(Contact, Force);
}

void ASailingWhales::Tick(float Dt)
{
    Super::Tick(Dt);
    auto* Yacht = Cast<ASailingYachtPawn>(UGameplayStatics::GetPlayerPawn(this,0));
    if (!Yacht || !WhaleMesh) return;
    Swim(*Yacht, Dt);
    Jump(*Yacht, Dt);
}
