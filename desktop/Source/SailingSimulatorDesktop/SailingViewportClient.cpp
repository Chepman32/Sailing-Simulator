#include "SailingViewportClient.h"

#include "DynamicRHI.h"
#include "DynamicResolutionState.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Engine/GameEngine.h"
#include "Engine/StaticMeshActor.h"
#include "EngineUtils.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/GameUserSettings.h"
#include "LegacyScreenPercentageDriver.h"
#include "Misc/CommandLine.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "SceneView.h"
#include "InputKeyEventArgs.h"
#include "HAL/IConsoleManager.h"
#include "SailingExplorer.h"
#include "SailingEntryBubbles.h"
#include "SailingLoadingScreen.h"
#include "SailingPlayerController.h"
#include "SailingSharks.h"
#include "SailingCrabs.h"
#include "SailingMarineTraffic.h"
#include "SailingWhales.h"
#include "SailingWeather.h"
#include "Kismet/GameplayStatics.h"
#include "SailingTrial.h"
#include "UnrealClient.h"
#include "RenderTimer.h"
#if PLATFORM_MAC
#include "Mac/MacPlatformApplicationMisc.h"
#include "Widgets/SWindow.h"
#endif

namespace
{
AStaticMeshActor* NearestTaggedMesh(UWorld* World, FName Tag)
{
    AStaticMeshActor* Nearest = nullptr;
    for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
    {
        if (It->ActorHasTag(Tag) &&
            (!Nearest || It->GetActorLocation().SizeSquared2D() < Nearest->GetActorLocation().SizeSquared2D()))
            Nearest = *It;
    }
    return Nearest;
}
}

void USailingViewportClient::Init(FWorldContext& WorldContext, UGameInstance* Instance, bool bCreateAudioDevice)
{
    Super::Init(WorldContext, Instance, bCreateAudioDevice);
    if (WorldContext.WorldType == EWorldType::Game)
    {
        InitializeDisplay();
#if PLATFORM_MAC
        bArmBackgroundIdle=FSlateApplication::IsInitialized() &&
            !FSlateApplication::Get().IsRenderingOffScreen() && !FApp::IsUnattended();
#endif
    }
    if (Sailing::CanShowLoadingScreen())
        OnViewportCreated().AddUObject(this, &USailingViewportClient::ShowStartupOverlay);
#if PLATFORM_MAC
    bActivatePreview = FParse::Param(FCommandLine::Get(), TEXT("SailingInteractivePreview")) &&
        !FApp::IsUnattended() && !FParse::Param(FCommandLine::Get(), TEXT("RenderOffscreen"));
#endif
    FParse::Value(FCommandLine::Get(), TEXT("SailingBenchmark="), BenchmarkPath);
    if (!BenchmarkPath.IsEmpty())
    {
        FParse::Value(FCommandLine::Get(), TEXT("SailingBenchmarkFrames="), MeasuredFrameCount);
        MeasuredFrameCount = FMath::Clamp(MeasuredFrameCount, 120, 18000);
        FrameTimesMs.Reserve(MeasuredFrameCount);
        if (FParse::Param(FCommandLine::Get(),TEXT("SailingFrameTrace"))) ThreadTimesMs.Reserve(MeasuredFrameCount);
    }
    FParse::Value(FCommandLine::Get(), TEXT("SailingWaterView="), WaterView);
    FParse::Value(FCommandLine::Get(), TEXT("SailingWaterFrames="), WaterFrames);
    if (!WaterFrames.IsEmpty())
    {
        bCaptureJpeg=FParse::Param(FCommandLine::Get(),TEXT("SailingWaterJpeg"));
        if (WaterView.IsEmpty()) WaterView=TEXT("chase");
        CaptureTimes=TEXT("frame,world_s,sea_s\n");
        if (FParse::Param(FCommandLine::Get(),TEXT("UseFixedTimeStep")))
        {
            // Shipping does not parse the engine's -FPS argument. Record on the
            // requested simulation clock even when reading a GPU image takes longer.
            float Rate=30;
            FParse::Value(FCommandLine::Get(),TEXT("FPS="),Rate);
            GEngine->FixedFrameRate=FMath::Clamp(Rate,12.f,120.f);
            GEngine->bUseFixedFrameRate=true;
            FApp::SetFixedDeltaTime(1./GEngine->FixedFrameRate);
        }
    }
    FParse::Value(FCommandLine::Get(), TEXT("SailingWaterFrameCount="), WaterFrameCount);
    WaterFrameCount=FMath::Clamp(WaterFrameCount,1,1200);
    bStartAlongside = !BenchmarkPath.IsEmpty() && FParse::Param(FCommandLine::Get(), TEXT("SailingBenchmarkAlongside"));
    if (!BenchmarkPath.IsEmpty() && FParse::Param(FCommandLine::Get(), TEXT("SailingBenchmarkDive")))
        DiveReplay = EDiveReplay::Leave;
}

void USailingViewportClient::InitializeDisplay()
{
    auto* Settings = GEngine->GetGameUserSettings();
    const auto PreviousMode = Settings->GetFullscreenMode();
    FString Saved;
    if (GConfig->GetString(TEXT("Sailing.World"), TEXT("RenderResolution"), Saved, GGameUserSettingsIni))
    {
        FIntPoint Size;
        if (Size.InitFromString(Saved) && Size.GetMin() > 0) RequestedResolution = Size;
    }
    else if (PreviousMode != EWindowMode::WindowedFullscreen)
    {
        // Old releases kept the chosen render size in the window's video mode.
        const FIntPoint Legacy = Settings->GetLastConfirmedScreenResolution();
        if (Legacy.GetMin() >= 720) RequestedResolution = Legacy;
    }
    ApplyRenderResolution();

    // The game engine creates the actual window after viewport client initialization.
    // Offscreen captures retain their command-line output dimensions.
    if (!FSlateApplication::IsInitialized() || FSlateApplication::Get().IsRenderingOffScreen() || GUsingNullRHI) return;
    const FIntPoint Desktop = Settings->GetDesktopResolution();
    UGameEngine::EnableGameWindowSettingsOverride(false);
    UGameUserSettings::RequestResolutionChange(Desktop.X, Desktop.Y, EWindowMode::WindowedFullscreen,
        false, Settings->GetClosestMonitorIndex());
    IConsoleManager::Get().CallAllConsoleVariableSinks();
    if (PreviousMode != EWindowMode::WindowedFullscreen)
    {
        Settings->SetFullscreenMode(EWindowMode::WindowedFullscreen);
        Settings->SetScreenResolution(Desktop);
        Settings->ConfirmVideoMode();
        GConfig->SetString(TEXT("Sailing.World"), TEXT("RenderResolution"), *RequestedResolution.ToString(), GGameUserSettingsIni);
        Settings->SaveSettings();
    }
}

void USailingViewportClient::SetRenderResolution(FIntPoint Size)
{
    if (Size == RequestedResolution) return;
    RequestedResolution = Size;
    ApplyRenderResolution();
    GConfig->SetString(TEXT("Sailing.World"), TEXT("RenderResolution"), *Size.ToString(), GGameUserSettingsIni);
    GEngine->GetGameUserSettings()->SaveSettings();
}

void USailingViewportClient::ApplyRenderResolution()
{
    auto* DynamicResolution = IConsoleManager::Get().FindConsoleVariable(TEXT("r.DynamicRes.OperationMode"));
    if (DynamicResolution) DynamicResolution->Set(RequestedResolution.GetMin() > 0 ? 0 : 2, ECVF_SetByGameOverride);
    ReconstructionScale = 1;
    PreviousSize = FIntPoint::ZeroValue;
    GpuTotalMs = 0;
    GpuSamples = 0;
}

void USailingViewportClient::ShowStartupOverlay()
{
    OnViewportCreated().RemoveAll(this);
    StartupOverlay = Sailing::MakeLoadingScreen();
    AddViewportWidgetContent(StartupOverlay.ToSharedRef(), MAX_int32);
}

void USailingViewportClient::RemoveStartupOverlay()
{
    if (!StartupOverlay) return;
    RemoveViewportWidgetContent(StartupOverlay.ToSharedRef());
    StartupOverlay.Reset();
}

void USailingViewportClient::DetachViewportClient()
{
    OnViewportCreated().RemoveAll(this);
    RemoveStartupOverlay();
    Super::DetachViewportClient();
}

void USailingViewportClient::FinalizeViews(FSceneViewFamily* Family, const TMap<ULocalPlayer*, FSceneView*>& PlayerViews)
{
    Super::FinalizeViews(Family, PlayerViews);
    if (PlayerViews.IsEmpty() || !Family->RenderTarget) return;
    if (StartupOverlay && !bDisableWorldRendering && GetWorld() && GetWorld()->HasBegunPlay())
    {
        // FinalizeViews runs before scene submission. Keep the card on that first draw.
        if (bSubmittedStartupFrame) RemoveStartupOverlay();
        bSubmittedStartupFrame = true;
    }
#if PLATFORM_MAC
    if (bActivatePreview)
    {
        const auto Window = GetWindow();
        auto* Player = GetWorld() ? Cast<ASailingPlayerController>(GetWorld()->GetFirstPlayerController()) : nullptr;
        if (Window.IsValid() && Window->IsVisible() && Player && GetGameViewportWidget().IsValid())
        {
            // The watcher starts a Unix executable. Activate its Cocoa window
            // once it actually contains the game and can receive native input.
            bActivatePreview = false;
            FMacPlatformApplicationMisc::ActivateApplication();
            Window->BringToFront(true);
            Player->UpdatePointerMode();
        }
    }
    if (bArmBackgroundIdle && GetWindow().IsValid() && GetWindow()->IsVisible() && FApp::HasFocus())
    {
        // Before Cocoa activates the first window, idling can stall startup.
        if (auto* Idle=IConsoleManager::Get().FindConsoleVariable(TEXT("t.IdleWhenNotForeground")))
            Idle->Set(1,ECVF_SetByGameSetting);
        bArmBackgroundIdle=false;
    }
#endif
    const FIntPoint Size = Family->RenderTarget->GetSizeXY();
    const double Now = FPlatformTime::Seconds();
    if (Now - DisplaySampleStart >= .5)
    {
        if (DisplaySampleStart > 0) DisplayFPS = (GFrameCounter - FirstDisplayFrame) / (Now - DisplaySampleStart);
        DisplaySampleStart = Now;
        FirstDisplayFrame = GFrameCounter;
    }
    if (!WaterView.IsEmpty()) UpdateWaterView();
    if (!BenchmarkPath.IsEmpty()) RecordBenchmark(Size, Now);
    if (GIsHighResScreenshot || !Family->SupportsScreenPercentage()) return;
    if (RequestedResolution.GetMin() > 0)
    {
        if (!Family->GetScreenPercentageInterface())
        {
            Family->EngineShowFlags.ScreenPercentage = true;
            // Run temporal AA and post-processing at the selected size too.
            // Slate still composites the HUD into the full-resolution window.
            Family->SecondaryViewFraction = Sailing::RenderResolutionFraction(RequestedResolution, Size);
            Family->SetScreenPercentageInterface(new FLegacyScreenPercentageDriver(*Family, 1.f));
        }
        return;
    }
    if (Size != PreviousSize)
    {
        PreviousSize = Size;
        ReconstructionScale = FMath::Min(1., FMath::Sqrt(1920. * 1080. / FMath::Max(1., double(Size.X) * Size.Y)));
        GpuTotalMs = 0;
        GpuSamples = 0;
    }
    // Bound the reconstruction output separately from the primary shading size.
    const auto* Budget=IConsoleManager::Get().FindTConsoleVariableDataFloat(TEXT("r.DynamicRes.FrameTimeBudget"));
    const double TargetMs=Budget ? FMath::Max(8.f,Budget->GetValueOnGameThread()) : 33.33;
    const double ReferencePixels=TargetMs<15. ? 1088.*680. : 1280.*800.;
    const double Pixels = double(Size.X) * Size.Y;
    if (Pixels <= ReferencePixels) return;

    // Primary dynamic resolution scales shading. On a Retina display TSR and the
    // following passes can exceed the frame budget even at the primary floor. Scale their
    // output only after sustained GPU pressure; the HUD is drawn at display size.
    const double GpuMs = FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles());
    if (GpuMs > 0)
    {
        GpuTotalMs += FMath::Min(GpuMs, 100.0);
        if (++GpuSamples == 12)
        {
            const double MeanMs = GpuTotalMs / GpuSamples;
            const float Floor = FMath::Sqrt(ReferencePixels / Pixels);
            if (MeanMs > TargetMs * 1.06)
            {
                ReconstructionScale = FMath::Max<float>(Floor, ReconstructionScale * FMath::Sqrt(TargetMs / MeanMs));
            }
            else if (MeanMs < TargetMs * .82)
            {
                ReconstructionScale = FMath::Min(1.f, ReconstructionScale + .009f);
            }
            GpuTotalMs = 0;
            GpuSamples = 0;
        }
    }
    Family->SecondaryViewFraction = FMath::Min(Family->SecondaryViewFraction, ReconstructionScale);
}

// Repeatable viewpoints for water captures and real-time frame measurements.
// The powered, turning and sailing runs use the regular helm and Chaos body.
void USailingViewportClient::UpdateWaterView()
{
    auto* Player=GetWorld() ? Cast<ASailingPlayerController>(GetWorld()->GetFirstPlayerController()) : nullptr;
    auto* Yacht=Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!Yacht) return;
    const bool Beach=WaterView==TEXT("beach"), WorldMenu=WaterView==TEXT("world");
    const bool Strand=WaterView==TEXT("strand");
    const bool RockWash=WaterView==TEXT("rockwash");
    const bool SeabedCrab=WaterView==TEXT("seabed-crabs");
    const bool CrabView=SeabedCrab || WaterView==TEXT("shore-crabs");
    const bool MerchantWake=WaterView==TEXT("merchant-wake");
    const bool AircraftView=WaterView==TEXT("aircraft") || WaterView==TEXT("banner")
        || WaterView==TEXT("stunt") || WaterView==TEXT("contrail");
    const bool Canopy=WaterView==TEXT("canopy");
    const bool ShoreWalk=WaterView==TEXT("shore-walk");
    const bool SandRock=WaterView==TEXT("sand-rock");
    const bool Sand=SandRock || WaterView==TEXT("sand") || WaterView==TEXT("sand-horizon");
    const bool Reef=WaterView==TEXT("reef");
    const bool Underwater=WaterView==TEXT("underwater");
    const bool CoastView=Beach || Strand || RockWash || Canopy || Underwater || Reef || MerchantWake || CrabView;
    const bool ShoreApproach=WaterView==TEXT("shore-approach");
    const bool Waterline = WaterView == TEXT("waterline");
    const bool Pirate=WaterView==TEXT("pirate");
    const bool BuoyView=WaterView==TEXT("buoy");
    const bool MooredView=BuoyView || Pirate || WaterView==TEXT("ship-shadow");
    const bool Dolphin=WaterView==TEXT("dolphin"), DistantWhale=WaterView==TEXT("distant-whale");
    const bool Whale=WaterView==TEXT("whale") || DistantWhale;
    const bool EntryTransition=WaterView==TEXT("entry-transition");
    const bool Entry=WaterView==TEXT("entry") || EntryTransition, Shark=WaterView==TEXT("shark");
    const float Now=GetWorld()->GetTimeSeconds();
    if (WaterViewStart<0)
    {
        const FName Tag=BuoyView ? TEXT("SailingChannelBuoy") : Pirate ? TEXT("SailingPirate") : TEXT("SailingMerchant");
        AStaticMeshActor* Subject=MooredView ? NearestTaggedMesh(GetWorld(), Tag) : nullptr;
        if (MooredView && !Subject)
        {
            UE_LOG(LogTemp, Warning, TEXT("The %s replay needs its moored subject in the level."), *WaterView);
            WaterView=TEXT("sail");
            return;
        }
        WaterViewStart=Now;
        if (WorldMenu) Player->ToggleWorld();
        else if (ShoreWalk || Sand)
        {
            Yacht->ToggleExplorer();
            auto& Explorer = Yacht->Explorer();
            FVector Footing=Sand ? FVector(32200,7590,0) : FVector(34850,10950,0);
            if (SandRock) Footing={28548,8409,0};
            Footing.Z = Explorer.GroundAt(Footing, 1200.);
            Explorer.State = ESkipperMode::Shore;
            Explorer.Yaw = SandRock ? -57.f : Sand ? -96.f : 16.f;
            Explorer.Pitch = SandRock ? -43.f : WaterView==TEXT("sand") ? -45.f : Sand ? -3.25f : -7.f;
            Explorer.StandAt(Footing, FVector::ZeroVector);
            Explorer.SetWorldLocationAndRotation(Footing+FVector(0,0,162),FRotator(Explorer.Pitch,Explorer.Yaw,0));
        }
        else if (!Entry && WaterView!=TEXT("chase"))
        {
            WaterCamera=GetWorld()->SpawnActor<ACameraActor>();
            WaterCamera->GetCameraComponent()->bConstrainAspectRatio=false;
            WaterCamera->GetCameraComponent()->SetFieldOfView(63);
            FVector Start=CoastView && !RockWash ? FVector(31000,4000,35) : FVector(0,0,35);
            FRotator Heading=FRotator::ZeroRotator;
            double SurgeCmS=(CoastView || AircraftView || Shark || Dolphin || Whale) ? 0 : 450;
            double Throttle=.9;
            if (ShoreApproach)
            {
                Start={19600,-12200,12};
                SurgeCmS=600;
                Throttle=1;
            }
            if (BuoyView)
            {
                const FVector Mooring = Subject->GetActorLocation();
                const FVector Eye = Mooring + FVector(-730, -470, 275);
                const FVector Aim = Mooring + FVector(0, 0, 145);
                WaterCamera->SetActorLocationAndRotation(Eye, (Aim - Eye).Rotation());
                Start = Mooring + FVector(-1400, -840, 35);
                SurgeCmS = 0;
            }
            else if (Subject)
            {
                FTransform Pose=Subject->GetActorTransform();
                if (Pirate)
                {
                    const FVector Wreck=Pose.GetLocation();
                    Pose.SetLocation({Wreck.X,Wreck.Y,0});
                    Pose.SetRotation(FRotator(0,Pose.Rotator().Yaw,0).Quaternion());
                }
                Start=Pose.TransformPosition(Pirate ? FVector(-1250,-2300,35) : FVector(5170,-2250,42));
                Heading=Pirate ? Pose.Rotator() : Pose.TransformVectorNoScale({-.24,.97,0}).Rotation();
                const FVector Eye=Pose.TransformPosition(Pirate ? FVector(4000,-8950,1700) : FVector(5770,-4450,1460));
                const FVector Aim=Pose.TransformPosition(Pirate ? FVector(830,0,2010) : FVector(5050,-1630,130));
                if (Pirate) WaterCamera->GetCameraComponent()->SetFieldOfView(59);
                WaterCamera->SetActorLocationAndRotation(Eye,(Aim-Eye).Rotation());
                SurgeCmS=0;
            }
            Yacht->SetActorLocationAndRotation(Start,Heading,false,nullptr,ETeleportType::TeleportPhysics);
            auto* Body=CastChecked<UPrimitiveComponent>(Yacht->GetRootComponent());
            Body->SetPhysicsLinearVelocity(FVector(SurgeCmS,0,0));
            Yacht->SetEngineRunning(!CoastView && !AircraftView && !MooredView && !Shark && !Dolphin && !Whale && !Waterline && WaterView!=TEXT("sail"));
            Yacht->SetThrottle(Yacht->ReadHelm().bEngineOn ? Throttle : 0);
            Player->SetViewTarget(WaterCamera.Get());
        }
    }
    const float Age=Now-WaterViewStart;
    if (ShoreWalk)
    {
        const bool Walk = Age>=8.f && Age<13.f;
        if (Player->IsInputKeyDown(EKeys::W) != Walk)
            Player->InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::W, Walk ? IE_Pressed : IE_Released, Walk ? 1.f : 0.f));
    }
    if (Entry)
    {
        if (Age<2) return;
        if (Yacht->Explorer().Mode()==ESkipperMode::Helm)
        {
            Player->InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::T, IE_Pressed, 1.f));
            Player->InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::T, IE_Released, 0.f));
        }
        if (EntryTransition)
        {
            if (Age<4.45f) return;
        }
        else
        {
            if (Yacht->Explorer().Mode()!=ESkipperMode::Swim) return;
            if (EntryTime<0) EntryTime=Now;
            if (Now-EntryTime<.23) return;
        }
        if (!EntryTransition && CapturedFrames==0 && !WaterFrames.IsEmpty())
        {
            const auto& Plume = Yacht->EntryBubbles();
            int32 Width,Height,Visible=0;
            Player->GetViewportSize(Width,Height);
            for (int32 I=0; I<Plume.GetInstanceCount(); ++I)
            {
                FTransform Bubble;
                FVector2D Pixel;
                if (Plume.GetInstanceTransform(I,Bubble,true) &&
                    Player->ProjectWorldLocationToScreen(Bubble.GetLocation(),Pixel) &&
                    Pixel.X>=0 && Pixel.Y>=0 && Pixel.X<Width && Pixel.Y<Height) ++Visible;
            }
            UE_LOG(LogTemp,Display,TEXT("Water entry capture: %d of %d bubbles in the diver's field of view"),Visible,Plume.GetInstanceCount());
        }
    }
    bool SubjectReady=true;
    if (WaterCamera.IsValid() && !MooredView)
    {
        const FVector Forward=Yacht->GetActorForwardVector().GetSafeNormal2D();
        const FVector Beam(-Forward.Y,Forward.X,0), Center=Yacht->GetActorLocation()*0.01;
        FVector Eye=Beach ? FVector(322,61,2.7) : Center-Forward*25+Beam*4+FVector(0,0,14);
        FVector Aim=Beach ? FVector(344,73,.32) : Center-Forward*6;
        if (Strand)
        {
            Eye={322,78.7,1.76};
            Aim={338,63.,.48};
        }
        if (AircraftView)
        {
            // Observe the same flight path from one station for the whole pass.
            Eye={-12.,9.,5.8};
            const FName Subject=WaterView==TEXT("contrail") ? TEXT("Cruising airliner") :
                WaterView==TEXT("stunt") ? TEXT("Aerobatic plane") : TEXT("Sightseeing floatplane");
            TActorIterator<ASailingWeather> Weather(GetWorld());
            if (Weather)
            {
                TInlineComponentArray<UStaticMeshComponent*> Models(*Weather);
                for (const auto* Model : Models)
                    if (Model->GetFName()==Subject)
                    {
                        Aim=Model->GetComponentLocation()*.01;
                        SubjectReady=Model->IsVisible() && (WaterView==TEXT("contrail") || FVector::Dist2D(Aim,Eye)<164.);
                    }
            }
        }
        if (RockWash)
        {
            // Match the reference tilt from the flooded foot of the rock
            // to the approaching set, keeping the same rock at frame left.
            Eye={374.1,59.5,4.15};
            const double Tilt=FMath::SmoothStep(8.,11.25,double(Age));
            const double Reach=FMath::Lerp(4.8,21.5,Tilt);
            Aim=Eye+FVector(-.949*Reach,-.315*Reach,-3.85);
        }
        if (MerchantWake)
        {
            const auto* Ship=Yacht->Traffic().FirstShip();
            if (!Ship) return;
            const FVector Hull=Ship->GetActorLocation()*.01, Bow=Ship->GetActorForwardVector(), BeamDir=Ship->GetActorRightVector();
            Aim=Hull-Bow*74.;
            Eye=Hull-Bow*205.+BeamDir*132.+FVector(0,0,97.);
        }
        if (CrabView)
        {
            const FVector Bank=SeabedCrab ? FVector(14.,15.,-1.7) : FVector(320.,82.,2.2);
            FVector Animal;
            SubjectReady=Age>1 && Yacht->Crabs().Nearest(SeabedCrab,Bank*100.,Animal);
            Aim=SubjectReady ? Animal*.01+FVector(0,0,SeabedCrab ? .07 : .035) : Bank;
            Eye=Aim+(SeabedCrab ? FVector(-.62,-.86,.58) : FVector(-.53,-.54,.42));
        }
        if (Underwater)
        {
            Eye={312,57,-1.15};
            Aim={316,59,.38};
        }
        if (Reef)
        {
            const double Advance = FMath::Clamp(Age-8.,0.,10.)*.68;
            Eye={290+Advance,61,-2.7};
            Aim={322+Advance,70,-3.3};
        }
        if (Canopy)
        {
            Eye={348.5,109.5,5.6};
            Aim={382,117,7.3};
        }
        if (Waterline)
        {
            Eye = Center - Forward*13.5 + Beam*9.5;
            Eye.Z = FMath::Max(Center.Z+3.1, Yacht->SurfaceHeightM(FVector2D(Eye))+1.4);
            Aim = Center + FVector(0,0,3.5);
        }
        if (Shark)
        {
            TActorIterator<ASailingSharks> School(GetWorld());
            if (School)
            {
                TInlineComponentArray<UStaticMeshComponent*> Animals(*School);
                if (Animals.Num())
                {
                    const UStaticMeshComponent& Body = *Animals[0];
                    const FVector Fin = Body.GetComponentLocation()*.01;
                    const FVector Heading = Body.GetForwardVector().GetSafeNormal2D();
                    Eye = Fin+(Fin-Center).GetSafeNormal2D()*7.5+Heading*.9;
                    Eye.Z = FMath::Max(1.75,Yacht->SurfaceHeightM(FVector2D(Eye))+.75);
                    Aim = Fin+Heading*.25-FVector(0,0,.30);
                    SubjectReady = Body.IsVisible();
                }
            }
        }
        if (Dolphin || Whale)
        {
            const TSubclassOf<AActor> Species = Dolphin ? ASailingDolphinPod::StaticClass() : ASailingWhales::StaticClass();
            AActor* Group = UGameplayStatics::GetActorOfClass(GetWorld(),Species);
            if (!Group || Group->IsHidden()) return;
            TInlineComponentArray<UStaticMeshComponent*> Bodies(Group);
            const FName Name = Dolphin ? FName(TEXT("Dolphin1")) : FName(DistantWhale ? TEXT("DistantWhale") : TEXT("SurfacingWhale"));
            const auto* Found = Bodies.FindByPredicate([&](const auto* Body){return Body->GetFName()==Name;});
            if (!Found || (!(*Found)->IsVisible() && (!Whale || CapturedFrames==0))) return;
            Aim = (*Found)->GetComponentLocation()*.01;
            const double Depth=Yacht->SurfaceHeightM(FVector2D(Aim))-Aim.Z;
            SubjectReady=Depth < (Dolphin ? .15 : .95);
            if (Whale)
            {
                Aim.Z+=FMath::Max(0.,Depth-.15);
                const auto& Print=Yacht->SurfaceImpacts().WhalePrints[DistantWhale ? 1 : 0];
                const float AgeOfPrint=Yacht->SeaFrame().TimeS-Print.B;
                if (Print.A>.5f && AgeOfPrint>=0 && AgeOfPrint<16.)
                {
                    const FVector2D Contact(Print.R,Print.G);
                    Aim=FMath::Lerp(Aim,FVector(Contact,Yacht->SurfaceHeightM(Contact)),
                        double(FMath::SmoothStep(0.f,1.3f,AgeOfPrint)));
                }
                const FVector Heading = (*Found)->GetForwardVector().GetSafeNormal2D();
                const FVector Side = FVector::CrossProduct(FVector::UpVector, Heading);
                Eye = Aim + Side*23. + Heading*8. + FVector(0,0,4.);
                Eye.Z=FMath::Max(Eye.Z,Yacht->SurfaceHeightM(FVector2D(Eye))+1.6);
            }
            else
                Eye=Aim+(*Found)->GetRightVector()*4.2+(*Found)->GetForwardVector()*.9+FVector(0,0,3.2);
        }
        if (ShoreApproach)
        {
            Eye={194,-151,9};
            Aim=FMath::Lerp(Center,FVector(224,-122,1.4),.18)+FVector(0,0,1.2);
        }
        WaterCamera->SetActorLocationAndRotation(Eye*100,(Aim-Eye).Rotation());
        if (WaterView==TEXT("turn")) Yacht->SetRudder(Age>6 && Age<12 ? .73 : 0);
    }
    if ((!Entry && Age<(ShoreApproach ? 1. : 8.)) || WaterFrames.IsEmpty() || (!SubjectReady && !CapturedFrames)) return;
    if (CapturedFrames<WaterFrameCount)
    {
        if (Sand && CapturedFrames==0)
        {
            FHitResult Ground;
            auto& Observer=Yacht->Explorer();
            Observer.GroundAt(Observer.Feet,Observer.Feet.Z+80.,&Ground);
            UE_LOG(LogTemp, Display, TEXT("Shore capture: footing %s on %s, eye %s, pitch %.1f, local water %.1f cm"),
                *Observer.Feet.ToCompactString(), *GetNameSafe(Ground.GetActor()),
                *Observer.GetComponentLocation().ToCompactString(), Observer.Pitch, Yacht->RenderedSurfaceHeightM(FVector2D(Observer.Feet)*.01)*100.);
        }
        const FString File=FPaths::Combine(WaterFrames,FString::Printf(TEXT("%04d.%s"),CapturedFrames,
            bCaptureJpeg ? TEXT("jpg") : TEXT("png")));
        CaptureTimes.Appendf(TEXT("%d,%.6f,%.6f\n"),CapturedFrames,Now,Yacht->SeaFrame().TimeS);
        FScreenshotRequest::RequestScreenshot(File,WorldMenu,false,false,FIntRect(),WorldMenu);
    }
    if (++CapturedFrames==WaterFrameCount+4)
    {
        FFileHelper::SaveStringToFile(CaptureTimes,*FPaths::Combine(WaterFrames,TEXT("clock.csv")));
        FPlatformMisc::RequestExit(false,TEXT("Water capture complete"));
    }
}

void USailingViewportClient::RecordBenchmark(FIntPoint Size, double Now)
{
    if (bStartAlongside && !PrepareAlongsideBenchmark()) return;
    if (DiveReplay != EDiveReplay::None && !PrepareDiveBenchmark()) return;
    if (BenchmarkFrames == 0) BenchmarkStart = Now;
    const double FrameMs = (Now - PreviousFrame) * 1000.0;
    PreviousFrame = Now;
    if (++BenchmarkFrames <= 120 || Now - BenchmarkStart < 5.0) return;
    FrameTimesMs.Add(FrameMs);
    FDynamicResolutionStateInfos Dynamic;
    GEngine->GetDynamicResolutionCurrentStateInfos(Dynamic);
    const double Primary = Dynamic.Status==EDynamicResolutionStatus::Enabled || Dynamic.Status==EDynamicResolutionStatus::DebugForceEnabled
        ? Dynamic.ResolutionFractionApproximations[GDynamicPrimaryResolutionFraction] : 1.;
    const float Output=RequestedResolution.GetMin()>0 ? Sailing::RenderResolutionFraction(RequestedResolution,Size) : ReconstructionScale;
    ShadingFractionSum+=Primary*Output;
    OutputFractionSum+=Output;
    if (ThreadTimesMs.Max() > 0)
        ThreadTimesMs.Emplace(FPlatformTime::ToMilliseconds(GGameThreadTime),FPlatformTime::ToMilliseconds(GRenderThreadTime),
            FPlatformTime::ToMilliseconds(GRHIThreadTime),FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles()));
    if (FrameTimesMs.Num() < MeasuredFrameCount) return;

    if (ThreadTimesMs.Num()==FrameTimesMs.Num())
    {
        FString Trace=TEXT("frame,wall_ms,game_ms,render_ms,rhi_ms,gpu_ms\n");
        for (int32 I=0; I<FrameTimesMs.Num(); ++I)
        {
            const auto& Timing=ThreadTimesMs[I];
            Trace.Appendf(TEXT("%d,%.3f,%.3f,%.3f,%.3f,%.3f\n"),I+1,FrameTimesMs[I],Timing.X,Timing.Y,Timing.Z,Timing.W);
        }
        FFileHelper::SaveStringToFile(Trace,*(BenchmarkPath+TEXT(".frames.csv")));
    }
    FrameTimesMs.Sort();
    double TotalMs = 0;
    int32 SlowFrames = 0, MissedTwo = 0, Hitches = 0, Over60 = 0;
    for (double Ms : FrameTimesMs)
    {
        TotalMs += Ms;
        if (Ms > 1000.0 / 60.0) ++Over60;
        if (Ms > 1000.0 / 30.0) ++SlowFrames;
        if (Ms > 2000.0 / 30.0) ++MissedTwo;
        if (Ms > 100.) ++Hitches;
    }
    const int32 Count = FrameTimesMs.Num();
    const FString Result = FString::Printf(
        TEXT("width,height,frames,average_fps,p95_frame_ms,frames_over_33_33_ms,p50_frame_ms,p99_frame_ms,max_frame_ms,frames_over_66_67_ms,frames_over_100_ms,mean_shading_percent,mean_reconstruction_percent,frames_over_16_67_ms\n%d,%d,%d,%.2f,%.2f,%d,%.2f,%.2f,%.2f,%d,%d,%.1f,%.1f,%d\n"),
        Size.X, Size.Y, Count, 1000.0 * Count / TotalMs, FrameTimesMs[FMath::CeilToInt(.95 * Count) - 1], SlowFrames,
        FrameTimesMs[(Count-1)/2], FrameTimesMs[FMath::CeilToInt(.99 * Count)-1], FrameTimesMs.Last(), MissedTwo, Hitches, 100.*ShadingFractionSum/Count,100.*OutputFractionSum/Count,Over60);
    const bool bSaved = FFileHelper::SaveStringToFile(Result, *BenchmarkPath);
    BenchmarkPath.Reset();
    FPlatformMisc::RequestExitWithStatus(false, bSaved ? 0 : 1, TEXT("SailingBenchmark"));
}

bool USailingViewportClient::PrepareAlongsideBenchmark()
{
    UWorld* World = GetWorld();
    APlayerController* Player = World ? World->GetFirstPlayerController() : nullptr;
    ASailingYachtPawn* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!Yacht) return false;
    if (AStaticMeshActor* Merchant = NearestTaggedMesh(World, TEXT("SailingMerchant")))
    {
        const FTransform Pose = Merchant->GetActorTransform();
        Yacht->SetActorLocationAndRotation(Pose.TransformPosition({-4800,-1570,35}), Pose.GetRotation(),
                                           false, nullptr, ETeleportType::TeleportPhysics);
        CastChecked<UPrimitiveComponent>(Yacht->GetRootComponent())->SetPhysicsLinearVelocity(Merchant->GetActorForwardVector()*260);
        Yacht->RecenterView();
    }
    bStartAlongside = false;
    return true;
}

bool USailingViewportClient::PrepareDiveBenchmark()
{
    auto* Player = GetWorld() ? Cast<ASailingPlayerController>(GetWorld()->GetFirstPlayerController()) : nullptr;
    auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!Yacht) return false;
    const auto Key = [&](FKey Which, bool bDown)
    {
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(Which, bDown ? IE_Pressed : IE_Released, bDown ? 1.f : 0.f));
    };
    if (DiveReplay == EDiveReplay::Leave)
    {
        Key(EKeys::T, true);
        Key(EKeys::T, false);
        DiveReplay = EDiveReplay::Submerge;
    }
    else if (DiveReplay == EDiveReplay::Submerge && Yacht->Explorer().Mode() == ESkipperMode::Swim)
    {
        Key(EKeys::C, true);
        DiveInputStart = GetWorld()->GetTimeSeconds();
        DiveReplay = EDiveReplay::Settle;
    }
    else if (DiveReplay == EDiveReplay::Settle && GetWorld()->GetTimeSeconds() - DiveInputStart > 2.4)
    {
        Key(EKeys::C, false);
        DiveReplay = EDiveReplay::None;
    }
    return DiveReplay == EDiveReplay::None;
}
