#if WITH_DEV_AUTOMATION_TESTS
#include "Components/AudioComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "EngineUtils.h"
#include "InputKeyEventArgs.h"
#include "Misc/AutomationTest.h"
#include "SailingEntryBubbles.h"
#include "SailingPlayerController.h"
#include "SailingTrial.h"
#include "SailingVoyageSound.h"
#include "SailingWhales.h"

namespace
{
void ToggleSound(ASailingPlayerController& Player)
{
    Player.InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::M, IE_Pressed, 1));
    Player.InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::M, IE_Released, 0));
}

class FWatchWhaleBreach : public IAutomationLatentCommand
{
public:
    FWatchWhaleBreach(FAutomationTestBase& InTest, ASailingPlayerController& Controller,
                      UStaticMeshComponent& Whale, UStaticMeshComponent& NearbyWhale, USailingEntryBubbles& Plume)
        : Test(InTest), Player(&Controller), Body(&Whale), Visitor(&NearbyWhale), Bubbles(&Plume),
          Start(Controller.GetWorld()->GetTimeSeconds()), bOriginalSound(Controller.Sound().Enabled())
    {
        if (const auto* Yacht = Controller.GetPawn<ASailingYachtPawn>()) LastPrint = Yacht->SurfaceImpacts().WhalePrints[1].B;
        if (bOriginalSound) ToggleSound(Controller);
    }

    bool Update() override
    {
        auto* Yacht = Player.IsValid() ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
        if (!Yacht || !Body.IsValid() || !Bubbles.IsValid())
        {
            Test.AddError(TEXT("The yacht and whale left the live scene during the test"));
            return true;
        }
        const double Now = Yacht->GetWorld()->GetTimeSeconds();
        if (const auto* Shore = Yacht->ShoreGeometry())
        {
            for (const auto* Mesh : {Body.Get(), Visitor.Get()})
            {
                if (!Mesh || !Mesh->IsVisible()) continue;
                const FVector2D Centre = FVector2D(Mesh->Bounds.Origin) * .01;
                bClearOfShore &= Shore->CorridorClear(Centre, Centre, 50. + Mesh->Bounds.SphereRadius * .01);
            }
        }
        if (Body->IsVisible())
        {
            const FVector Belly = Body->GetComponentTransform().TransformPosition({125., 0., -263.});
            const double Clearance = Belly.Z*.01 - Yacht->RenderedSurfaceHeightM(FVector2D(Belly)*.01);
            PeakBellyM = FMath::Max(PeakBellyM, Clearance);
            if (Clearance > .9 && FMath::Abs(Body->GetComponentRotation().Roll) > 35.)
            {
                FVector2D Screen;
                int32 Width, Height;
                Player->GetViewportSize(Width, Height);
                if (Player->ProjectWorldLocationToScreen(Belly, Screen) && Width > 0 && Height > 0)
                {
                    const FVector2D UV = Screen / FVector2D(Width, Height);
                    if (FVector2D::DistSquared(UV, FVector2D(.5)) < FVector2D::DistSquared(ClosestScreen, FVector2D(.5)))
                        ClosestScreen = UV;
                    if (UV.X > .08 && UV.X < .92 && FMath::Abs(UV.X - .5) > .13 && UV.Y > .05 && UV.Y < .94)
                        bBreachInView = true;
                }
                FVector Eye;
                FRotator View;
                Player->GetPlayerViewPoint(Eye, View);
                const double Bearing = FMath::FindDeltaAngleDegrees(View.Yaw, (Belly - Eye).Rotation().Yaw);
                if (FMath::Abs(Bearing) < FMath::Abs(ClosestBearing)) ClosestBearing = Bearing;
            }
        }
        const auto& Print = Yacht->SurfaceImpacts().WhalePrints[1];
        if (Print.A > 1.15f && Print.B > LastPrint)
        {
            LastPrint = Print.B;
            LastCrash = Now;
            if (++Crashes == 1)
            {
                FirstCrash = Now;
                bFirstBreachInView = bBreachInView;
            }
            if (bBreachInView) ++VisibleBreaches;
            bBreachInView = false;
            ImpactXY = FVector2D(Print.R, Print.G)*100.;
            const double RangeM = FVector2D::Distance(ImpactXY, FVector2D(Yacht->GetActorLocation()))*.01;
            Test.TestTrue(TEXT("The splash stays offshore and within viewing range"), RangeM > 115. && RangeM < 260.);
        }
        if (Crashes && Now - LastCrash < .6 && Bubbles->GetInstanceCount() > 16) bBubblePlume = true;
        for (const auto* Voice : TInlineComponentArray<UAudioComponent*>(Player.Get()))
        {
            if (Voice->GetFName() != TEXT("WhaleImpactVoice") || !Voice->IsPlaying()) continue;
            if (!bSoundArmed) bPlayedWhileMuted = true;
            else if (!bHeardImpact)
            {
                bHeardImpact = true;
                Test.TestEqual(TEXT("The landing sound is positioned at its splash"),
                    FVector2D::Distance(ImpactXY, FVector2D(Voice->GetComponentLocation())), 0., 10.);
                Test.TestTrue(TEXT("The listener hears the distant slap after seeing it"),
                    Voice->bAllowSpatialization && Now - LastCrash > .25 && Now - LastCrash < .95);
            }
        }
        if (Crashes == 1 && Now - FirstCrash > 1.5 && !bSoundArmed)
        {
            ToggleSound(*Player.Get());
            bSoundArmed = true;
        }
        if ((Crashes == 0 && Now - Start < 66.) || (Crashes == 1 && Now - FirstCrash < 67.) ||
            (Crashes >= 2 && Now - LastCrash < 2.)) return false;

        Test.AddInfo(FString::Printf(TEXT("Observed %d breaches, belly reached %.2f m above the wave, first impact at %.1f s, interval %.1f s"),
            Crashes, PeakBellyM, FirstCrash, LastCrash - FirstCrash));
        Test.AddInfo(FString::Printf(TEXT("Closest breach bearing %.1f degrees, projected screen position %.2f / %.2f"),
            ClosestBearing, ClosestScreen.X, ClosestScreen.Y));
        Test.AddInfo(FString::Printf(TEXT("%d breaches appeared beside the sails, including the first: %s"),
            VisibleBreaches, bFirstBreachInView ? TEXT("yes") : TEXT("no")));
        Test.TestTrue(TEXT("A whale rolls above the waves and beside the sails in the chase view"), VisibleBreaches > 0);
        if (FirstCrash - Start > 3.) Test.TestTrue(TEXT("The first breach is in view beside the sails"), bFirstBreachInView);
        Test.TestEqual(TEXT("Two jumps each leave one heavy impact"), Crashes, 2);
        Test.TestTrue(TEXT("The body impact leaves a bubble plume"), bBubblePlume);
        Test.TestTrue(TEXT("The bodies of both whales stay at least 50 metres off the shore"), bClearOfShore);
        Test.TestFalse(TEXT("The first landing respects mute"), bPlayedWhileMuted);
        if (Yacht->GetWorld()->AllowAudioPlayback()) Test.TestTrue(TEXT("The second landing plays its own sound"), bHeardImpact);
        if (Player->Sound().Enabled() != bOriginalSound) ToggleSound(*Player.Get());
        return true;
    }

private:
    FAutomationTestBase& Test;
    TWeakObjectPtr<ASailingPlayerController> Player;
    TWeakObjectPtr<UStaticMeshComponent> Body;
    TWeakObjectPtr<UStaticMeshComponent> Visitor;
    TWeakObjectPtr<USailingEntryBubbles> Bubbles;
    double Start, FirstCrash = 0., LastCrash = 0., LastPrint = -1., PeakBellyM = -100.;
    double ClosestBearing = 180.;
    FVector2D ClosestScreen = FVector2D(-10.);
    FVector2D ImpactXY = FVector2D::ZeroVector;
    int32 Crashes = 0, VisibleBreaches = 0;
    bool bOriginalSound, bSoundArmed = false, bBreachInView = false, bFirstBreachInView = false, bBubblePlume = false;
    bool bClearOfShore = true;
    bool bPlayedWhileMuted = false, bHeardImpact = false;
};
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingWhaleBreachTest, "Sailing.Wildlife.WhaleBreach",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingWhaleBreachTest::RunTest(const FString&)
{
    UWorld* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Player = World ? Cast<ASailingPlayerController>(World->GetFirstPlayerController()) : nullptr;
    if (!TestNotNull(TEXT("Live sailing controller"), Player)) return false;
    const auto* Yacht = Player->GetPawn<ASailingYachtPawn>();
    const auto* Shore = Yacht ? Yacht->ShoreGeometry() : nullptr;
    if (!TestNotNull(TEXT("The authored coast is surveyed"), Shore)) return false;
    TestFalse(TEXT("Two offshore endpoints cannot make a lane through Light Cay"),
              Shore->CorridorClear({153., -122.}, {353., -122.}, 50.));
    TestFalse(TEXT("A route parallel to Light Cay is rejected inside the buffer"),
              Shore->CorridorClear({199., -128.}, {199., -116.}, 50.));
    TestTrue(TEXT("Open water west of Light Cay admits a lane"),
             Shore->CorridorClear({115., -135.}, {115., -105.}, 50.));
    TActorIterator<ASailingWhales> Whales(World);
    if (!TestTrue(TEXT("The live map has whales"), bool(Whales))) return false;
    UStaticMeshComponent* Body = nullptr;
    UStaticMeshComponent* Visitor = nullptr;
    USailingEntryBubbles* Bubbles = nullptr;
    for (auto* Component : TInlineComponentArray<UStaticMeshComponent*>(*Whales))
    {
        if (Component->GetFName() == TEXT("DistantWhale")) Body = Component;
        if (Component->GetFName() == TEXT("SurfacingWhale")) Visitor = Component;
        if (Component->GetFName() == TEXT("FarWhaleBubbles")) Bubbles = Cast<USailingEntryBubbles>(Component);
    }
    if (!TestNotNull(TEXT("The distant whale has a visible mesh"), Body) ||
        !TestNotNull(TEXT("The visiting whale has a visible mesh"), Visitor) ||
        !TestNotNull(TEXT("The distant whale has a bubble plume"), Bubbles)) return false;
    ADD_LATENT_AUTOMATION_COMMAND(FWatchWhaleBreach(*this, *Player, *Body, *Visitor, *Bubbles));
    return true;
}
#endif
