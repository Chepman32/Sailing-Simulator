#include "SailingJetSkiMotion.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Components/AudioComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "InputKeyEventArgs.h"
#include "Misc/AutomationTest.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "SailingExplorer.h"
#include "SailingJetSki.h"
#include "SailingMarineTraffic.h"
#include "SailingPlayerController.h"
#include "SailingTrial.h"
#include "SailingVoyageSound.h"
#include "Sound/SoundWave.h"
#include "UnrealClient.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FJetSkiMotionTest, "Sailing.JetSki.Motion",
    EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)

bool FJetSkiMotionTest::RunTest(const FString&)
{
    const auto Drive = [](Sailing::FJetSkiMotion& Ski, double Gas, double Steer, double Seconds) {
        for (int32 Step = 0; Step < FMath::RoundToInt(60 * Seconds); ++Step)
            Ski.Advance(Gas, Steer, 1. / 60.);
    };
    Sailing::FJetSkiMotion Ski;
    Drive(Ski, 1, 0, 1.5);
    TestTrue(TEXT("A jet ski accelerates promptly onto plane"), Ski.SpeedMps() > 6.);
    Drive(Ski, 1, 0, 10.);
    TestTrue(TEXT("Full throttle reaches a bounded planing speed"), Ski.SpeedMps() > 17. && Ski.SpeedMps() < 23.);

    Sailing::FJetSkiMotion OffPower = Ski;
    Drive(Ski, 1, 1, 1.25);
    Drive(OffPower, 0, 1, 1.25);
    TestTrue(TEXT("The waterjet turns harder under power"), Ski.YawRad > .8 && Ski.YawRad > 2. * OffPower.YawRad);
    TestTrue(TEXT("The ski banks into a powered turn"), Ski.BankDegrees > 10.);

    const double BeforeBraking = Ski.SpeedMps();
    Drive(Ski, -1, 0, 1.4);
    TestTrue(TEXT("The reverse bucket quickly brakes forward travel"), Ski.SpeedMps() < .6 * BeforeBraking);
    Drive(Ski, -1, 0, 4.);
    TestTrue(TEXT("Reverse is much slower than the forward jet"), Ski.SurgeMps() < -1.5 && Ski.SpeedMps() < 3.3);

    Sailing::FJetSkiMotion Parked;
    Drive(Parked, 0, 1, 1.);
    TestTrue(TEXT("The steering nozzle cannot turn a stopped ski without thrust"),
        FMath::IsNearlyZero(Parked.YawRad) && FMath::IsNearlyZero(Parked.SpeedMps()));
    return true;
}

namespace
{
class FRideJetSki final : public IAutomationLatentCommand
{
public:
    FRideJetSki(ASailingPlayerController& InPlayer, ASailingJetSki& InSki, FAutomationTestBase& InTest)
        : Player(&InPlayer), Ski(&InSki), Test(InTest), bOriginalSound(InPlayer.Sound().Enabled())
    {
        FParse::Value(FCommandLine::Get(), TEXT("SailingJetSkiShots="), Shots);
    }

    ~FRideJetSki() override
    {
        if (Voice.IsValid()) Voice->OnAudioSingleEnvelopeValueNative.Remove(Envelope);
    }

    bool Update() override
    {
        auto* Yacht = Player.IsValid() ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
        if (!Yacht || !Ski.IsValid()) return true;
        auto& Explorer = Yacht->Explorer();
        const double Now = Yacht->GetWorld()->GetTimeSeconds();
        switch (Stage)
        {
        case EStage::Start:
            Tap(EKeys::T);
            Stage = EStage::Swim;
            Deadline = Now + 7.;
            return false;
        case EStage::Swim:
            if (Explorer.Mode() != ESkipperMode::Swim || Explorer.DepthM() > .45f) break;
            PlaceSwimmer(*Yacht);
            Stage = EStage::Board;
            Deadline = Now + 2.;
            return false;
        case EStage::Board:
        {
            PlaceSwimmer(*Yacht);
            Test.TestEqual(TEXT("The ski offers a boarding prompt"), FString(Explorer.Prompt(*Yacht)), FString(TEXT("Press E to ride the jet ski")));
            Tap(EKeys::E);
            if (!Test.TestTrue(TEXT("E boards the nearby ski"), Explorer.MountedJetSki() == Ski.Get())) return Restore(*Yacht);
            Test.TestTrue(TEXT("The yacht stays hove to"), Yacht->ReadHelm().bHoveTo);
            const FTransform OriginalPose=Ski->GetActorTransform();
            FRotator Ripple=OriginalPose.Rotator();
            Ripple.Pitch+=12; Ripple.Roll+=16;
            const FRotator Horizon=Explorer.GetComponentRotation();
            Ski->SetActorRotation(Ripple);
            Explorer.Advance(*Yacht,1.f/60.f);
            const FRotator Shift=Explorer.GetComponentRotation()-Horizon;
            Test.TestTrue(TEXT("Short hull chop leaves the rider's horizon steady"),
                FMath::Abs(Shift.Pitch)<.4 && FMath::Abs(Shift.Roll)<.4);
            Ski->SetActorTransform(OriginalPose);
            if (!bOriginalSound) Tap(EKeys::M);
            Stage = EStage::Idle;
            Deadline = Now + 3.;
            return false;
        }
        case EStage::Idle:
            for (auto* Component : TInlineComponentArray<UAudioComponent*>(Player.Get()))
                if (Component->GetFName() == TEXT("JetSkiEngineVoice")) Voice = Component;
            if (!Voice.IsValid() || !Voice->IsPlaying()) break;
            if (const auto* Wave = Cast<USoundWave>(Voice->GetSound()))
                Test.TestTrue(TEXT("The supplied engine loop is selected"), Wave->GetFName() == TEXT("JetSkiEngine") && Wave->bLooping);
            Tap(EKeys::M);
            Envelope = Voice->OnAudioSingleEnvelopeValueNative.AddLambda(
                [this](const UAudioComponent*, const USoundWave*, float Value) { Peak = FMath::Max(Peak, Value); });
            IdlePitch = Voice->PitchMultiplier;
            Tap(EKeys::M);
            SetKey(EKeys::S, true);
            Stage = EStage::Reverse;
            Deadline = Now + 6.;
            return false;
        case EStage::Reverse:
            if (Now < Deadline) return false;
            Test.TestTrue(TEXT("The hull stops before running up the beach"), Ski->HasWaterClearance() && Ski->Drive().SpeedMps() < .8);
            SetKey(EKeys::S, false);
            Start = Ski->GetActorLocation();
            SetKey(EKeys::W, true);
            Stage = EStage::Accelerate;
            Deadline = Now + 2.25;
            return false;
        case EStage::Accelerate:
        {
            if (Now < Deadline) return false;
            Test.TestTrue(TEXT("Holding gas planes away from the beach"),
                Ski->Drive().SpeedMps() > 9. && FVector::DistSquaredXY(Start, Ski->GetActorLocation()) > FMath::Square(950.));
            const FVector2D Center=FVector2D(Ski->GetActorLocation())*.01;
            const FVector2D Bow=Ski->Drive().Bow(), Beam(-Bow.Y,Bow.X);
            double Wave=0;
            for (int32 Aft=3; Aft<=18; ++Aft)
            {
                const auto Sample=Yacht->Traffic().Field().At(Center-Bow*Aft+Beam*(.70+.035*Aft),Yacht->SeaFrame().TimeS);
                Wave=FMath::Max(Wave,FMath::Abs(Sample.HeightM));
            }
            Test.TestTrue(TEXT("The moving ski sends a gravity wave outside its jet wash"),Wave>.002);
            Test.TestTrue(TEXT("The running engine produces samples and revs up"),
                Voice.IsValid() && Voice->IsPlaying() && Voice->PitchMultiplier > IdlePitch && Peak > .001f);
            Tap(EKeys::E);
            Test.TestTrue(TEXT("Dismounting waits for a low speed"), Explorer.MountedJetSki() == Ski.Get());
            TurnStart = Ski->GetActorRotation().Yaw;
            SetKey(EKeys::D, true);
            Stage = EStage::Turn;
            Deadline = Now + .85;
            return false;
        }
        case EStage::Turn:
            if (Now < Deadline) return false;
            Test.TestTrue(TEXT("The rider can turn and bank under power"),
                FRotator::NormalizeAxis(Ski->GetActorRotation().Yaw - TurnStart) > 28. && Ski->Drive().BankDegrees > 8.);
            if (!Shots.IsEmpty()) FScreenshotRequest::RequestScreenshot(FPaths::Combine(Shots, TEXT("jet-ski-ride.png")), true, false);
            SetKey(EKeys::W, false);
            SetKey(EKeys::D, false);
            SetKey(EKeys::S, true);
            Stage = EStage::Brake;
            Deadline = Now + 4.;
            return false;
        case EStage::Brake:
            if (!Ski->CanDismount()) break;
            SetKey(EKeys::S, false);
            Tap(EKeys::E);
            Test.TestTrue(TEXT("E steps off into the water or onto the shore"),
                Explorer.Mode() == ESkipperMode::Swim || Explorer.Mode() == ESkipperMode::Shore);
            Stage = EStage::Silence;
            Deadline = Now + .5;
            return false;
        case EStage::Silence:
            if (Now < Deadline) return false;
            Test.TestTrue(TEXT("The jet engine goes quiet after leaving the seat"), Voice.IsValid() && !Voice->IsPlaying());
            return Restore(*Yacht);
        }
        if (Now < Deadline) return false;
        Test.AddError(FString::Printf(TEXT("Jet ski voyage timed out at stage %d"), int32(Stage)));
        return Restore(*Yacht);
    }

private:
    enum class EStage { Start, Swim, Board, Idle, Reverse, Accelerate, Turn, Brake, Silence };

    void SetKey(FKey Key, bool Down)
    {
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(Key, Down ? IE_Pressed : IE_Released, Down ? 1.f : 0.f));
    }

    void Tap(FKey Key) { SetKey(Key, true); SetKey(Key, false); }

    void PlaceSwimmer(ASailingYachtPawn& Yacht)
    {
        const FVector Alongside = Ski->Seat() + Ski->GetActorRightVector().GetSafeNormal2D() * 425.;
        const double Water = Yacht.RenderedSurfaceHeightM(FVector2D(Alongside) * .01) * 100.;
        const FVector Eye(Alongside.X, Alongside.Y, Water + 75.);
        auto& Explorer = Yacht.Explorer();
        Explorer.SetWorldLocation(Eye);
        const FRotator Angle = (Ski->Seat() - Eye).Rotation() - Explorer.GetComponentRotation();
        Explorer.Look(FRotator::NormalizeAxis(Angle.Yaw) / .13, FRotator::NormalizeAxis(Angle.Pitch) / .13);
        if (Stage == EStage::Swim && !Shots.IsEmpty())
            FScreenshotRequest::RequestScreenshot(FPaths::Combine(Shots, TEXT("jet-ski-berth.png")), true, false);
    }

    bool Restore(ASailingYachtPawn& Yacht)
    {
        for (const FKey& Key : {EKeys::W, EKeys::D, EKeys::S}) SetKey(Key, false);
        if (Yacht.Explorer().Away()) Tap(EKeys::T);
        if (Player->Sound().Enabled() != bOriginalSound) Tap(EKeys::M);
        return true;
    }

    TWeakObjectPtr<ASailingPlayerController> Player;
    TWeakObjectPtr<ASailingJetSki> Ski;
    TWeakObjectPtr<UAudioComponent> Voice;
    FAutomationTestBase& Test;
    FDelegateHandle Envelope;
    FString Shots;
    FVector Start = FVector::ZeroVector;
    double Deadline = 0., TurnStart = 0.;
    float IdlePitch = 0., Peak = 0.;
    EStage Stage = EStage::Start;
    bool bOriginalSound;
};
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FJetSkiVoyageTest, "Sailing.JetSki.Voyage",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FJetSkiVoyageTest::RunTest(const FString&)
{
    UWorld* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Player = World ? Cast<ASailingPlayerController>(World->GetFirstPlayerController()) : nullptr;
    auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!TestNotNull(TEXT("The playable catamaran"), Yacht)) return false;
    TestEqual(TEXT("A ski at each island shore and at the quay"), Yacht->JetSkis().Num(), 8);
    TSet<const UStaticMesh*> Models;
    TSet<FName> Sites;
    ASailingJetSki* TestSki = nullptr;
    for (ASailingJetSki* Ski : Yacht->JetSkis())
    {
        Sites.Add(Ski->BerthName());
        const UStaticMesh* Mesh = CastChecked<UStaticMeshComponent>(Ski->GetRootComponent())->GetStaticMesh();
        if (TestNotNull(TEXT("A detailed model is loaded"), Mesh))
        {
            TestEqual(TEXT("Each model has three detail levels"), Mesh->GetNumLODs(), 3);
            Models.Add(Mesh);
        }
        TestTrue(Ski->BerthName().ToString() + TEXT(" has clearance at the launch site"), Ski->HasWaterClearance());
        if (Ski->BerthName() == TEXT("Long Cay")) TestSki = Ski;
    }
    TestEqual(TEXT("The eight supplied watercraft variants are loaded"), Models.Num(), 8);
    TestEqual(TEXT("Every berth is distinct"), Sites.Num(), Yacht->JetSkis().Num());
    if (!TestNotNull(TEXT("The Long Cay jet ski"), TestSki)) return false;
    ADD_LATENT_AUTOMATION_COMMAND(FRideJetSki(*Player, *TestSki, *this));
    return true;
}
#endif
