#if WITH_DEV_AUTOMATION_TESTS
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/PrimitiveComponent.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/StaticMeshActor.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerStart.h"
#include "Misc/AutomationTest.h"
#include "Misc/CommandLine.h"
#include "Misc/Paths.h"
#include "SailingTrial.h"
#include "SailingSharks.h"
#include "SailingWhales.h"
#include "SailingEncounter.h"
#include "SailingWeather.h"
#include "UnrealClient.h"

namespace
{
struct FCoastView
{
    const TCHAR* Name;
    FVector CameraM;
    FVector AimM;
};

class FWatchFins : public IAutomationLatentCommand
{
public:
    FWatchFins(FAutomationTestBase& InTest, ASailingYachtPawn& Boat, ASailingSharks& School, AStaticMeshActor* Ship=nullptr)
        : Test(InTest), Yacht(&Boat), Start(Boat.GetWorld()->GetTimeSeconds()), Helm(Boat.ReadHelm()),
          Original(Boat.GetActorTransform()), bAlongside(Ship!=nullptr)
    {
        School.GetComponents(Bodies);
        Test.TestEqual(TEXT("One reef shark in the encounter"), Bodies.Num(), 1);
        TActorIterator<ASailingDolphinPod> Dolphin(Boat.GetWorld());
        if (Dolphin) Pod=*Dolphin;
        TActorIterator<ASailingWhales> Whales(Boat.GetWorld());
        if (Whales) Whales->GetComponents(WhaleBodies);
        Test.TestEqual(TEXT("Surfacing and distant whales in the play world"),WhaleBodies.Num(),2);
        const FTransform Departure=Ship ? Ship->GetActorTransform() : FTransform::Identity;
        FVector StartPoint(0,0,20);
        if (Ship) StartPoint = Ship->ActorHasTag(TEXT("SailingPirate")) ? FVector(-1400,-1550,35) : FVector(-4800,-2050,35);
        auto* Body = CastChecked<UPrimitiveComponent>(Boat.GetRootComponent());
        OriginalVelocity = Body->GetPhysicsLinearVelocity();
        OriginalSpin = Body->GetPhysicsAngularVelocityInRadians();
        Boat.SetActorLocationAndRotation(Departure.TransformPosition(StartPoint),
                                        Departure.GetRotation(),false,nullptr,ETeleportType::TeleportPhysics);
        Body->SetPhysicsLinearVelocity(FVector::ZeroVector);
        Body->SetPhysicsAngularVelocityInRadians(FVector::ZeroVector);
        Boat.SetThrottle(0);
        Boat.SetRudder(0);
        Boat.SetEngineRunning(false);
    }
    bool Update() override
    {
        if (!Yacht.IsValid()) return true;
        const double Age = Yacht->GetWorld()->GetTimeSeconds()-Start;
        if (Age>9 && Age<10) { Yacht->SetEngineRunning(true); Yacht->SetThrottle(.9); }
        if (!bAlongside && Age>18 && Age<30) Yacht->SetRudder(.67);
        else Yacht->SetRudder(0);
        if (Age<2) return false;
        int32 Fins=0;
        for (const auto* Body : Bodies)
        {
            if (!Body || !Body->IsVisible() || !Body->GetStaticMesh()) continue;
            const FVector Tip = Body->GetComponentLocation();
            const double Distance = FVector::Dist2D(Tip,Yacht->GetActorLocation())*.01;
            const double Above = Tip.Z*.01-Yacht->SurfaceHeightM(FVector2D(Tip)*.01);
            if (Distance>=24 && Distance<=36 && Above>.10 && Above<.42 &&
                !Yacht->GetWorld()->LineTraceTestByChannel(Tip+FVector(0,0,6500),Tip-FVector(0,0,160),ECC_Visibility,
                    FCollisionQueryParams(NAME_None,true,Yacht.Get()))) ++Fins;
        }
        const double Now = Yacht->GetWorld()->GetTimeSeconds();
        if (Sailing::SharkDive(Now)==0 && FMath::Fmod(Now,100.)>2)
        {
            ++Samples;
            One += Fins==1;
        }
        if (Sailing::SharkDive(Now)==1 && Bodies.Num()==1)
        {
            ++DeepSamples;
            if (Bodies[0]->IsVisible()) ++Unexpected;
        }
        if (Pod.IsValid() && !Pod->IsHidden() && Fins) ++Unexpected;
        for (const UStaticMeshComponent* Whale : WhaleBodies)
        {
            if (!Whale || !Whale->IsVisible() || !Whale->GetStaticMesh()) continue;
            const FVector P=Whale->GetComponentLocation();
            if (P.Z*.01 > Yacht->SurfaceHeightM(FVector2D(P)*.01))
            {
                bSawBack |= Whale->GetFName()==TEXT("SurfacingWhale");
                bSawBreach |= Whale->GetFName()==TEXT("DistantWhale");
            }
        }
        PeakSpeed=FMath::Max(PeakSpeed,Yacht->GetVelocity().Size2D()*.01);
        if (Age<101) return false;
        Test.AddInfo(FString::Printf(TEXT("Single fin at 24–36 m in %d/%d surface samples; %d deep samples"),One,Samples,DeepSamples));
        Test.TestTrue(TEXT("The shark patrols about thirty metres offshore"),Samples>0 && One>=.80*Samples);
        Test.TestTrue(TEXT("The shark retreats and never accompanies the pod"),DeepSamples>0 && Unexpected==0);
        Test.TestTrue(TEXT("The yacht was actually under way"),PeakSpeed>2.);
        if (!bAlongside) Test.TestTrue(TEXT("Both whales break the actual sea surface"),bSawBack && bSawBreach);
        Yacht->SetThrottle(Helm.Throttle);
        Yacht->SetRudder(Helm.Rudder);
        Yacht->SetEngineRunning(Helm.bEngineOn);
        Yacht->SetActorTransform(Original,false,nullptr,ETeleportType::TeleportPhysics);
        auto* Body = CastChecked<UPrimitiveComponent>(Yacht->GetRootComponent());
        Body->SetPhysicsLinearVelocity(OriginalVelocity);
        Body->SetPhysicsAngularVelocityInRadians(OriginalSpin);
        return true;
    }
private:
    FAutomationTestBase& Test;
    TWeakObjectPtr<ASailingYachtPawn> Yacht;
    TArray<UStaticMeshComponent*> Bodies;
    double Start, PeakSpeed=0;
    Sailing::FHelm Helm;
    FTransform Original;
    FVector OriginalVelocity, OriginalSpin;
    TArray<UStaticMeshComponent*> WhaleBodies;
    bool bAlongside, bSawBack=false, bSawBreach=false;
    TWeakObjectPtr<ASailingDolphinPod> Pod;
    int32 Samples=0, One=0, DeepSamples=0, Unexpected=0;
};

// Optional photographs of the real play world. Keep the fine sea mesh beside
// the subject while the fixed camera lets different builds use the same framing.
class FPhotographCoast : public IAutomationLatentCommand
{
public:
    FPhotographCoast(ASailingYachtPawn& InYacht, const FTransform& Ship, const FTransform& OuterShip,
                     const FVector& Station, FString InFolder)
        : Yacht(&InYacht), Folder(MoveTemp(InFolder)), Original(InYacht.GetActorTransform())
    {
        const auto Point = [&Ship](double X,double Y,double Z) { return Ship.TransformPosition({X*100,Y*100,Z*100})*.01; };
        const FVector Light = Station*.01;
        Views.Add({TEXT("ship-broadside.png"), Point(7,-52,11), Point(-35,0,3)});
        Views.Add({TEXT("ship-opposite.png"), OuterShip.TransformPosition({-7600,3700,700})*.01,
                    OuterShip.TransformPosition({-3400,0,300})*.01});
        Views.Add({TEXT("tanker-at-anchor.png"), Point(85,-158,61), Point(4,0,6)});
        Views.Add({TEXT("gas-carrier.png"), OuterShip.TransformPosition({9000,16900,6900})*.01,
                    OuterShip.TransformPosition({250,0,680})*.01});
        Views.Add({TEXT("light-station.png"), Light+FVector(42,-46,13), Light+FVector(2,0,15)});
        Views.Add({TEXT("lantern.png"), Light+FVector(13,-16,26.8), Light+FVector(0,0,26.8)});
        Views.Add({TEXT("green-coast.png"), {322,43,4.6}, {344,109,4.3}});
        Views.Add({TEXT("breaking-surf.png"), {269,-158,3.7}, {259,-135,.75}});
    }

    bool Update() override
    {
        if (!Yacht.IsValid()) return true;
        UWorld* World = Yacht->GetWorld();
        APlayerController* Player = World->GetFirstPlayerController();
        const double Now = FPlatformTime::Seconds();
        if (Now < Next) return false;
        if (Index == Views.Num())
        {
            Player->SetViewTarget(Yacht.Get());
            if (Player->GetHUD()) Player->GetHUD()->bShowHUD = bHUDWasVisible;
            Yacht->SetActorTransform(Original,false,nullptr,ETeleportType::TeleportPhysics);
            if (Camera.IsValid()) Camera->Destroy();
            return true;
        }
        const auto& View = Views[Index];
        if (!bExposing)
        {
            if (!Camera.IsValid())
            {
                Camera = World->SpawnActor<ACameraActor>();
                Camera->GetCameraComponent()->bConstrainAspectRatio = false;
                if (Player->GetHUD())
                {
                    bHUDWasVisible = Player->GetHUD()->bShowHUD;
                    Player->GetHUD()->bShowHUD = false;
                }
            }
            const FVector Dir = (View.AimM-View.CameraM).GetSafeNormal();
            Yacht->SetActorLocation((View.CameraM-Dir.GetSafeNormal2D()*12)*FVector(100,100,0) + FVector(0,0,22),
                                    false,nullptr,ETeleportType::TeleportPhysics);
            CastChecked<UPrimitiveComponent>(Yacht->GetRootComponent())->SetPhysicsLinearVelocity(FVector::ZeroVector);
            Camera->SetActorLocationAndRotation(View.CameraM*100, Dir.Rotation());
            Camera->GetCameraComponent()->SetFieldOfView(63);
            Player->SetViewTarget(Camera.Get());
            bExposing = true;
            Next = Now+2.2;
        }
        else
        {
            FScreenshotRequest::RequestScreenshot(FPaths::Combine(Folder,View.Name), false, false);
            ++Index;
            bExposing = false;
            Next = Now+.45;
        }
        return false;
    }

private:
    TWeakObjectPtr<ASailingYachtPawn> Yacht;
    TWeakObjectPtr<ACameraActor> Camera;
    FString Folder;
    FTransform Original;
    TArray<FCoastView> Views;
    int32 Index = 0;
    bool bExposing = false;
    bool bHUDWasVisible = true;
    double Next = 0;
};
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FCoastalShipTest, "Sailing.Coast.ShipAlongside",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPirateAnchorageTest, "Sailing.Coast.PirateAnchorage",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FPirateAnchorageTest::RunTest(const FString&)
{
    UWorld* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    if (!TestNotNull(TEXT("Playable level"), World)) return false;
    TActorIterator<APlayerStart> Start(World);
    if (!TestTrue(TEXT("Charted departure"), bool(Start))) return false;
    int32 Ships = 0;
    for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
    {
        if (!It->ActorHasTag(TEXT("SailingPirate"))) continue;
        ++Ships;
        const UStaticMeshComponent* Component = It->GetStaticMeshComponent();
        const UStaticMesh* Ship = Component->GetStaticMesh();
        if (!TestNotNull(TEXT("Pirate ship mesh"), Ship)) continue;
        TestEqual(TEXT("Authored ship"), Ship->GetFName(), FName(TEXT("SM_SirensLight")));
        TestEqual(TEXT("Opaque and cutout atlas sections"), Component->GetNumMaterials(), 2);
        if (TestEqual(TEXT("Three distance levels"), Ship->GetNumLODs(), 3))
        {
            const int32 Near = Ship->GetNumTriangles(0), Mid = Ship->GetNumTriangles(1), Far = Ship->GetNumTriangles(2);
            TestTrue(TEXT("Detailed model alongside with economical distance levels"), Near > 180000 && Mid < Near/2 && Far < Near/5 && Far > 0);
            AddInfo(FString::Printf(TEXT("Pirate ship has %d / %d / %d triangles"), Near, Mid, Far));
        }
        const FTransform Pose = It->GetActorTransform();
        const FBox Bounds = Ship->GetBoundingBox();
        const FVector Across = Start->GetActorRightVector();
        const double SideOfCourse = FMath::Sign(FVector::DotProduct(Pose.GetLocation() - Start->GetActorLocation(), Across));
        double Clearance = TNumericLimits<double>::Max();
        for (double X : {Bounds.Min.X, Bounds.Max.X})
        for (double Y : {Bounds.Min.Y, Bounds.Max.Y})
        {
            const FVector Offset = Pose.TransformPosition({X,Y,0}) - Start->GetActorLocation();
            Clearance = FMath::Min(Clearance, SideOfCourse * FVector::DotProduct(Offset, Across));
        }
        TestTrue(TEXT("The departure course clears the rig and a 20 m swimming circle"), Clearance >= 2000);
        for (double Side : {-1., 1.})
        for (double Z : {-75., 60.})
        for (ECollisionChannel Channel : {ECC_PhysicsBody, ECC_Camera, ECC_Pawn})
        {
            FHitResult Hit;
            const bool Blocked = World->SweepSingleByChannel(Hit, Pose.TransformPosition({0, Side*1800, Z}),
                Pose.TransformPosition({0, 0, Z}), FQuat::Identity, Channel, FCollisionShape::MakeSphere(25));
            TestTrue(TEXT("Yacht, camera and swimmer meet the outside of either broadside"),
                Blocked && Hit.GetActor() == *It && Side*Pose.InverseTransformPosition(Hit.ImpactPoint).Y > 300);
        }
    }
    TestEqual(TEXT("One charted pirate anchorage"), Ships, 1);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FCoastalFinsTest, "Sailing.Wildlife.FinsUnderWay",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FCoastalFinsTest::RunTest(const FString&)
{
    UWorld* World=GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Yacht=World ? Cast<ASailingYachtPawn>(World->GetFirstPlayerController()->GetPawn()) : nullptr;
    if (!TestNotNull(TEXT("Playable yacht"),Yacht)) return false;
    TActorIterator<ASailingSharks> School(World);
    if (!TestTrue(TEXT("The play world contains the shark school"),bool(School))) return false;
    ADD_LATENT_AUTOMATION_COMMAND(FWatchFins(*this,*Yacht,**School));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSharksAtAnchorTest, "Sailing.Wildlife.FinsAtTheQuay",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPirateFinsTest, "Sailing.Wildlife.FinsAtPirateShip",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FPirateFinsTest::RunTest(const FString&)
{
    UWorld* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Yacht = World ? Cast<ASailingYachtPawn>(World->GetFirstPlayerController()->GetPawn()) : nullptr;
    if (!TestNotNull(TEXT("Playable yacht"), Yacht)) return false;
    TActorIterator<ASailingSharks> School(World);
    if (!TestTrue(TEXT("Sharks present at the pirate ship"),bool(School))) return false;
    for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
        if (It->ActorHasTag(TEXT("SailingPirate")))
        {
            ADD_LATENT_AUTOMATION_COMMAND(FWatchFins(*this,*Yacht,**School,*It));
            return true;
        }
    AddError(TEXT("Missing pirate ship at the anchorage"));
    return false;
}

bool FSharksAtAnchorTest::RunTest(const FString&)
{
    UWorld* World=GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Yacht=World ? Cast<ASailingYachtPawn>(World->GetFirstPlayerController()->GetPawn()) : nullptr;
    if (!TestNotNull(TEXT("Playable yacht"),Yacht)) return false;
    TActorIterator<ASailingSharks> School(World);
    if (!TestTrue(TEXT("Sharks present at the anchorage"),bool(School))) return false;
    for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
        if (It->ActorHasTag(TEXT("SailingMerchant")) && It->GetActorLocation().Size2D()<70000)
        {
            ADD_LATENT_AUTOMATION_COMMAND(FWatchFins(*this,*Yacht,**School,*It));
            return true;
        }
    AddError(TEXT("The inner anchorage lacks its tanker"));
    return false;
}

bool FCoastalShipTest::RunTest(const FString& Parameters)
{
    UWorld* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    ASailingYachtPawn* Yacht = World ? Cast<ASailingYachtPawn>(World->GetFirstPlayerController()->GetPawn()) : nullptr;
    if (!TestNotNull(TEXT("Playable yacht"), Yacht)) return false;
    int32 Count = 0;
    AStaticMeshActor* NearShip = nullptr;
    AStaticMeshActor* OuterShip = nullptr;
    AStaticMeshActor* Light = nullptr;
    for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
    {
        UStaticMeshComponent* Mesh = It->GetStaticMeshComponent();
        if (!Mesh || !Mesh->GetStaticMesh()) continue;
        if (Mesh->GetStaticMesh()->GetFName() == TEXT("SM_LightStation"))
        {
            Light = *It;
            TestTrue(TEXT("The imported light station has the authored surface finishes"), Mesh->GetNumMaterials() >= 10);
        }
        if (!It->ActorHasTag(TEXT("SailingMerchant"))) continue;
        ++Count;
        const UStaticMesh* ShipMesh=Mesh->GetStaticMesh();
        const bool Tanker=ShipMesh->GetFName()==TEXT("SM_ProductTanker");
        TestTrue(TEXT("Each anchorage uses an authored merchant model"),Tanker || ShipMesh->GetFName()==TEXT("SM_GasCarrier"));
        const int32 Near=ShipMesh->GetNumTriangles(0);
        TestTrue(TEXT("Full-detail deck geometry is retained"),Near>(Tanker ? 180000 : 84000));
        if (TestEqual(TEXT("Three ship detail levels"),ShipMesh->GetNumLODs(),3))
        {
            const int32 Far=ShipMesh->GetNumTriangles(2);
            TestTrue(TEXT("Distant ships use less than a quarter of the close geometry"),Far<Near/4);
            AddInfo(FString::Printf(TEXT("%s: %d triangles alongside, %d at distance"),*ShipMesh->GetName(),Near,Far));
        }
        if (!NearShip || It->GetActorLocation().SizeSquared2D() < NearShip->GetActorLocation().SizeSquared2D()) NearShip = *It;
        if (!OuterShip || It->GetActorLocation().SizeSquared2D() > OuterShip->GetActorLocation().SizeSquared2D()) OuterShip = *It;
        const FTransform Pose = Mesh->GetComponentTransform();
        for (double X : {-5500., -3500., 0., 3500.})
        for (double Z : {-100., 110., 250.})
        for (double Side : {-1., 1.})
        {
            const FVector Start = Pose.TransformPosition({X, 1550*Side, Z});
            const FVector End = Pose.TransformPosition({X, 0, Z});
            FHitResult Hit;
            const FString Where = FString::Printf(TEXT("x=%.0f z=%.0f side=%.0f"), X,Z,Side);
            if (TestTrue(TEXT("Visible plating meets the waterline ")+Where,
                         Mesh->LineTraceComponent(Hit, Start, End, FCollisionQueryParams(NAME_None,true))))
            {
                const FVector Local = Pose.InverseTransformPosition(Hit.ImpactPoint);
                TestTrue(TEXT("Near shell is continuous ")+Where, Local.Y*Side > 830);
            }
            for (ECollisionChannel Channel : {ECC_Camera, ECC_PhysicsBody})
            {
                const bool bBlocked = World->SweepSingleByChannel(Hit,Start,End,FQuat::Identity,Channel,
                    FCollisionShape::MakeSphere(28), FCollisionQueryParams(NAME_None,false,Yacht));
                const FString Sweep = FString::Printf(TEXT("Ship at %s, channel %d, first hit %s. "),
                    *Pose.GetLocation().ToCompactString(), int(Channel), *GetNameSafe(Hit.GetActor()));
                TestTrue(Sweep+TEXT("The outer hull blocks the approach ")+Where,
                         bBlocked && Hit.GetActor() == *It && Pose.InverseTransformPosition(Hit.Location).Y*Side > 830);
            }
        }
    }
    TestEqual(TEXT("Both moored ships are covered"),Count,2);
    TestNotNull(TEXT("Light Cay has the modeled station"),Light);
    FString Folder;
    if (NearShip && OuterShip && Light && FParse::Value(FCommandLine::Get(),TEXT("SailingCoastShots="), Folder))
        ADD_LATENT_AUTOMATION_COMMAND(FPhotographCoast(*Yacht,NearShip->GetActorTransform(),OuterShip->GetActorTransform(),
                                                     Light->GetActorLocation(),Folder));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FHurricaneSailingTest, "Sailing.Yacht.HurricaneSeakeeping",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::EngineFilter)

namespace
{
class FWatchHurricane : public IAutomationLatentCommand
{
public:
    FWatchHurricane(FAutomationTestBase& InTest, ASailingYachtPawn& Boat, ASailingWeather& InWeather)
        : Test(InTest), Yacht(&Boat), Weather(&InWeather), Original(Boat.GetActorTransform()),
          Helm(Boat.ReadHelm()), WeatherChoice(InWeather.WeatherChoice()), Start(Boat.GetWorld()->GetTimeSeconds())
    {
        auto* Body = CastChecked<UPrimitiveComponent>(Boat.GetRootComponent());
        Velocity = Body->GetPhysicsLinearVelocity();
        Spin = Body->GetPhysicsAngularVelocityInRadians();
        StartLeg();
    }

    bool Update() override
    {
        if (!Yacht.IsValid() || !Weather.IsValid()) return true;
        const double Age = Yacht->GetWorld()->GetTimeSeconds()-Start;
        if (Leg == 3)
        {
            if (Age < 12.) return false;
            Test.TestTrue(TEXT("The yacht rights herself after an inverted water entry"),Yacht->GetActorUpVector().Z>.85);
            Restore();
            return true;
        }
        const double Height = Yacht->GetActorLocation().Z*.01;
        if (Age > 0.)
        {
            MinUp = FMath::Min(MinUp,Yacht->GetActorUpVector().Z);
            Lowest = FMath::Min(Lowest,Height);
            Highest = FMath::Max(Highest,Height);
            double HullClearance = TNumericLimits<double>::Max();
            double WaterlineErrorSq = 0.;
            for (double X : {-400., -140., 140., 400.})
            for (double Y : {-190., 190.})
            {
                const FVector Keel = Yacht->GetActorTransform().TransformPositionNoScale({X,Y,-65.})*.01;
                const double Surface = Yacht->SurfaceHeightM(FVector2D(Keel));
                HullClearance = FMath::Min(HullClearance, Keel.Z - Surface);
                WaterlineErrorSq += FMath::Square(Keel.Z + .65 * Yacht->GetActorUpVector().Z - Surface);
            }
            if (Age > 5.)
            {
                StationErrorSq += WaterlineErrorSq;
                StationSamples += 8;
            }
            if (HullClearance>MaxClearance)
            {
                MaxClearance = HullClearance;
                ClearanceAge = Age;
                ClearancePosition = Yacht->GetActorLocation()*.01;
                ClearanceVelocity = Yacht->GetVelocity()*.01;
            }
            FMinimalViewInfo Camera;
            Yacht->CalcCamera(0,Camera);
            const double SeaAtCamera = Yacht->SurfaceHeightM(FVector2D(Camera.Location)*.01);
            MinCameraClearance = FMath::Min(MinCameraClearance,Camera.Location.Z*.01-SeaAtCamera);
        }
        if (Age < 90.0) return false;

        Test.TestEqual(TEXT("The selected sea state has developed"),Yacht->SeaFrame().Scale,
            Leg == 2 ? Sailing::StormSeaScale : Sailing::HurricaneSeaScale,.01f);
        Test.AddInfo(FString::Printf(TEXT("Leg %d: swell travel %.2f m, peak tilt %.1f deg, both hulls clear by at most %.2f m"),
            Leg+1, Highest-Lowest, FMath::RadiansToDegrees(FMath::Acos(MinUp)), MaxClearance));
        const double WaterlineRms = FMath::Sqrt(StationErrorSq/FMath::Max(1,StationSamples));
        Test.AddInfo(FString::Printf(TEXT("Leg %d: hull waterline RMS %.3f m"),Leg+1,WaterlineRms));
        Test.TestTrue(TEXT("The waterline stays within one loaded draft RMS of the local surface"),
            StationSamples>0 && WaterlineRms<.68);
        if (MaxClearance>.1)
            Test.AddInfo(FString::Printf(TEXT("Peak clearance at %.2f s, position %s m, velocity %s m/s"),
                ClearanceAge,*ClearancePosition.ToCompactString(),*ClearanceVelocity.ToCompactString()));
        Test.TestTrue(TEXT("The catamaran stays within 35 degrees of upright"),MinUp>FMath::Cos(FMath::DegreesToRadians(35.)));
        Test.TestTrue(TEXT("A crest cannot throw the entire yacht clear of the sea"),MaxClearance<.35);
        Test.TestTrue(TEXT("The exterior camera clears the visible sea throughout the run"),MinCameraClearance>.6);
        Test.TestTrue(TEXT("The catamaran rises and falls with the long swell"),Highest-Lowest>3.0);
        ++Leg;
        StartLeg();
        return false;
    }

private:
    void Restore()
    {
        Weather->SelectWeather(WeatherChoice);
        Yacht->SetActorTransform(Original,false,nullptr,ETeleportType::TeleportPhysics);
        auto* Body = CastChecked<UPrimitiveComponent>(Yacht->GetRootComponent());
        Body->SetPhysicsLinearVelocity(Velocity);
        Body->SetPhysicsAngularVelocityInRadians(Spin);
        Yacht->SetRudder(Helm.Rudder);
        Yacht->SetThrottle(Helm.Throttle);
        Yacht->SetEngineRunning(Helm.bEngineOn);
    }

    void StartLeg()
    {
        // Beam seas under sail, a powered head sea, then a quartering storm with helm on.
        const double Heading = Leg == 0 ? 0. : Leg == 1 ? 90. : -135.;
        const FVector2D Spot(-950.,-900.);
        const auto Frame = Yacht->SeaFrame();
        const auto Sea = Sailing::SampleSea(Spot,Frame.TimeS,0,Frame.Scale,true);
        const FRotator Attitude(0,Heading,Leg == 3 ? 180. : 0.);
        Yacht->SetActorLocationAndRotation(FVector(Spot,Sea.HeightM)*100.,Attitude,false,nullptr,ETeleportType::TeleportPhysics);
        auto* Body = CastChecked<UPrimitiveComponent>(Yacht->GetRootComponent());
        Body->SetPhysicsLinearVelocity(Attitude.Vector()*(Leg == 0 ? 300. : 750.) + FVector(0,0,Sea.VelocityMps.Z*100.));
        Body->SetPhysicsAngularVelocityInRadians(FVector::ZeroVector);
        Yacht->SetRudder(Leg == 2 ? .7 : 0.);
        Yacht->SetEngineRunning(Leg != 0);
        Yacht->SetThrottle(Leg == 0 ? 0. : 1.);
        Weather->SelectWeather(Leg == 2 ? 5 : 6);
        Start = Yacht->GetWorld()->GetTimeSeconds();
        MinUp = 1.;
        MaxClearance = 0.;
        StationErrorSq = 0.;
        StationSamples = 0;
        MinCameraClearance = TNumericLimits<double>::Max();
        Lowest = TNumericLimits<double>::Max();
        Highest = TNumericLimits<double>::Lowest();
    }

    FAutomationTestBase& Test;
    TWeakObjectPtr<ASailingYachtPawn> Yacht;
    TWeakObjectPtr<ASailingWeather> Weather;
    FTransform Original;
    Sailing::FHelm Helm;
    int32 WeatherChoice;
    double Start;
    FVector Velocity, Spin;
    int32 Leg = 0;
    double MinUp, MaxClearance, MinCameraClearance, Lowest, Highest;
    double StationErrorSq = 0.;
    int32 StationSamples = 0;
    double ClearanceAge = 0.;
    FVector ClearancePosition = FVector::ZeroVector, ClearanceVelocity = FVector::ZeroVector;
};
}

bool FHurricaneSailingTest::RunTest(const FString&)
{
    UWorld* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    APlayerController* Player = World ? World->GetFirstPlayerController() : nullptr;
    auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!TestNotNull(TEXT("Playable yacht"),Yacht)) return false;
    TActorIterator<ASailingWeather> Weather(World);
    if (!TestTrue(TEXT("World weather controls are available"),bool(Weather))) return false;
    ADD_LATENT_AUTOMATION_COMMAND(FWatchHurricane(*this,*Yacht,**Weather));
    return true;
}

namespace
{
// Measure the installed island mesh independently of the yacht's shore guard.
double DepthUnderHulls(const ASailingYachtPawn& Yacht, UStaticMeshComponent& Island)
{
    double Depth = 40;
    const FTransform Pose = Yacht.GetActorTransform();
    for (const double X : {-5.4, 0., 5.6})
    for (const double Y : {-2.3, 2.3})
    {
        const FVector At = Pose.TransformPositionNoScale({X*100,Y*100,0});
        FHitResult Hit;
        if (Island.LineTraceComponent(Hit,{At.X,At.Y,5000},{At.X,At.Y,-5000},FCollisionQueryParams(NAME_None,true)))
            Depth = FMath::Min(Depth,-.01*Hit.ImpactPoint.Z);
    }
    return Depth;
}

class FSailAtLightCay : public IAutomationLatentCommand
{
public:
    FSailAtLightCay(FAutomationTestBase& InTest, ASailingYachtPawn& InYacht, UStaticMeshComponent& InIsland)
        : Test(InTest), Yacht(InYacht), Island(InIsland), Original(InYacht.GetActorTransform()),
          OriginalHelm(InYacht.ReadHelm())
    {
        const auto* Body=CastChecked<UPrimitiveComponent>(Yacht.GetRootComponent());
        OriginalVelocity=Body->GetPhysicsLinearVelocity();
        OriginalSpin=Body->GetPhysicsAngularVelocityInRadians();
    }

    bool Update() override
    {
        struct FRun { const TCHAR* Name; double X, Yaw, Surge, Throttle, Duration; bool Grounded; };
        static constexpr FRun Runs[] = {
            {TEXT("Bow first at full power"),196,0,6,1,18,false},
            {TEXT("Stern first in reverse"),196,180,-4.5,-1,18,false},
            {TEXT("Already on the lighthouse beach with the engine off"),232,0,0,0,14,true},
        };
        const FRun& Run=Runs[Index];
        auto* Body=CastChecked<UPrimitiveComponent>(Yacht.GetRootComponent());
        const double Now=Yacht.GetWorld()->GetTimeSeconds();
        if (StartTime<0)
        {
            Yacht.SetActorLocationAndRotation({Run.X*100,-12200,Run.Grounded ? 150. : 12.},
                FRotator(0,Run.Yaw,0),false,nullptr,ETeleportType::TeleportPhysics);
            Body->SetPhysicsAngularVelocityInRadians(FVector::ZeroVector);
            Body->SetPhysicsLinearVelocity(Yacht.GetActorForwardVector()*Run.Surge*100);
            Yacht.SetEngineRunning(Run.Throttle!=0);
            Yacht.SetThrottle(Run.Throttle);
            Yacht.SetRudder(0);
            StartTime=Now;
            Minimum=40;
        }
        const double Age=Now-StartTime;
        const double Depth=DepthUnderHulls(Yacht,Island);
        Minimum=FMath::Min(Minimum,Depth);
        if (Age<Run.Duration-4) LastPosition=Yacht.GetActorLocation();
        if (Age<Run.Duration) return false;

        const double Travel=.01*FVector::Dist2D(LastPosition,Yacht.GetActorLocation());
        Test.AddInfo(FString::Printf(TEXT("%s: minimum under both hulls %.2f m, final %.2f m, moved %.1f m in the last four seconds"),
            Run.Name,Minimum,Depth,Travel));
        if (Run.Grounded)
            Test.TestTrue(TEXT("The seeded grounding reaches dry sand"),Minimum<.2);
        else
        {
            Test.TestTrue(FString(Run.Name)+TEXT(" approaches the shallows"),Minimum<12);
            Test.TestTrue(FString(Run.Name)+TEXT(" keeps the keels over water"),Minimum>=1.0);
            Test.TestTrue(FString(Run.Name)+TEXT(" remains maneuverable"),Travel>1.4);
        }
        Test.TestTrue(FString(Run.Name)+TEXT(" finishes afloat"),Depth>=1.55);
        Test.TestEqual(FString(Run.Name)+TEXT(" preserves the player's throttle"),Yacht.ReadHelm().Throttle,Run.Throttle);
        if (++Index<UE_ARRAY_COUNT(Runs)) { StartTime=-1; return false; }
        Yacht.SetActorTransform(Original,false,nullptr,ETeleportType::TeleportPhysics);
        Body->SetPhysicsLinearVelocity(OriginalVelocity);
        Body->SetPhysicsAngularVelocityInRadians(OriginalSpin);
        Yacht.SetEngineRunning(OriginalHelm.bEngineOn);
        Yacht.SetThrottle(OriginalHelm.Throttle);
        Yacht.SetRudder(OriginalHelm.Rudder);
        return true;
    }
private:
    FAutomationTestBase& Test;
    ASailingYachtPawn& Yacht;
    UStaticMeshComponent& Island;
    FTransform Original;
    Sailing::FHelm OriginalHelm;
    FVector OriginalVelocity, OriginalSpin, LastPosition;
    double StartTime=-1, Minimum=40;
    int32 Index=0;
};
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBeachContactTest,"Sailing.Coast.BeachApproachAndRefloat",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)
bool FBeachContactTest::RunTest(const FString&)
{
    UWorld* World=GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Yacht=World ? Cast<ASailingYachtPawn>(World->GetFirstPlayerController()->GetPawn()) : nullptr;
    if (!TestNotNull(TEXT("Playable yacht"),Yacht)) return false;
    for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
    {
        auto* Mesh=It->GetStaticMeshComponent();
        if (Mesh->GetStaticMesh() && Mesh->GetStaticMesh()->GetFName()==TEXT("SM_LightCay"))
        {
            ADD_LATENT_AUTOMATION_COMMAND(FSailAtLightCay(*this,*Yacht,*Mesh));
            return true;
        }
    }
    AddError(TEXT("Light Cay is missing from the test world"));
    return false;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FNavigableWaterTest,"Sailing.Coast.NavigableWater",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)
bool FNavigableWaterTest::RunTest(const FString&)
{
    UWorld* World=GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    if (!TestNotNull(TEXT("Playable world"),World)) return false;
    const Sailing::FShoreMap Map(*World);
    const bool Coral=World->GetMapName().EndsWith(TEXT("CoralPass"));
    TArray<FVector2D> Islands;
    if (Coral)
    {
#define CORAL_CAY(name,cx,cy,rx,ry,h,ridge,phase) Islands.Emplace(cx,cy);
#define CORAL_VOLCANO(cx,cy,r,h) Islands.Emplace(cx,cy);
#include "CoralPassLayout.inl"
#undef CORAL_CAY
#undef CORAL_VOLCANO
    }
    else Islands={{550,205},{805,-497},{1330,518}};
    for (const FVector2D Center : Islands)
        TestTrue(TEXT("A yacht inside the island at ")+Center.ToString(),Map.AtHull(Center,{1,0}).ClearanceM<0);
    TestTrue(TEXT("Open sea is freely navigable"), Map.AtHull({0,0},{1,0}).ClearanceM>30);
    if (Coral)
    {
        const FVector2D Bow(-1,0);
        Sailing::FRigidState Outbound{{211,-122,0},{211,-122,0},FRotator(0,180,0).Quaternion(),FVector(Bow*4.,0),FVector::ZeroVector};
        Sailing::FHelm Helm;
        Helm.bEngineOn=true;
        Helm.Throttle=1;
        Sailing::FLoads Loads;
        Sailing::FShoreGuard Guard;
        TestTrue(TEXT("The departure lies beside the shelf"),Map.AtHull(FVector2D(Outbound.OriginM),Bow).ClearanceM<10);
        TestFalse(TEXT("An outward course needs no refloat"),Guard.Constrain(Map,Outbound,Helm,1./60,Loads));
        TestTrue(TEXT("A skipper steering out to sea has full control"),Loads.ForceN.IsNearlyZero() && Loads.TorqueNm.IsNearlyZero());
    }
    return true;
}
#endif
