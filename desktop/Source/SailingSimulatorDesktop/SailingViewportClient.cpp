#include "SailingViewportClient.h"

#include "DynamicRHI.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Engine/StaticMeshActor.h"
#include "EngineUtils.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "SceneView.h"
#include "InputKeyEventArgs.h"
#include "HAL/IConsoleManager.h"
#include "SailingExplorer.h"
#include "SailingEntryBubbles.h"
#include "SailingPlayerController.h"
#include "SailingSharks.h"
#include "SailingWhales.h"
#include "Kismet/GameplayStatics.h"
#include "SailingTrial.h"
#include "UnrealClient.h"

namespace
{
AStaticMeshActor* NearestMooredShip(UWorld* World, FName Tag)
{
    AStaticMeshActor* Ship = nullptr;
    for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
    {
        if (It->ActorHasTag(Tag) &&
            (!Ship || It->GetActorLocation().SizeSquared2D() < Ship->GetActorLocation().SizeSquared2D()))
            Ship = *It;
    }
    return Ship;
}
}

void USailingViewportClient::Init(FWorldContext& WorldContext, UGameInstance* Instance, bool bCreateAudioDevice)
{
    Super::Init(WorldContext, Instance, bCreateAudioDevice);
    FParse::Value(FCommandLine::Get(), TEXT("SailingBenchmark="), BenchmarkPath);
    FParse::Value(FCommandLine::Get(), TEXT("SailingWaterView="), WaterView);
    FParse::Value(FCommandLine::Get(), TEXT("SailingWaterFrames="), WaterFrames);
    if (WaterView.IsEmpty() && !WaterFrames.IsEmpty()) WaterView=TEXT("chase");
    FParse::Value(FCommandLine::Get(), TEXT("SailingWaterFrameCount="), WaterFrameCount);
    WaterFrameCount=FMath::Clamp(WaterFrameCount,1,300);
    bStartAlongside = !BenchmarkPath.IsEmpty() && FParse::Param(FCommandLine::Get(), TEXT("SailingBenchmarkAlongside"));
    if (!BenchmarkPath.IsEmpty() && FParse::Param(FCommandLine::Get(), TEXT("SailingBenchmarkDive")))
        DiveReplay = EDiveReplay::Leave;
}

void USailingViewportClient::FinalizeViews(FSceneViewFamily* Family, const TMap<ULocalPlayer*, FSceneView*>& PlayerViews)
{
    Super::FinalizeViews(Family, PlayerViews);
    if (PlayerViews.IsEmpty() || !Family->RenderTarget) return;
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
    if (Size != PreviousSize)
    {
        PreviousSize = Size;
        ReconstructionScale = 1;
        GpuTotalMs = 0;
        GpuSamples = 0;
    }
    // At 1280 x 800 the storm stays within the M5's 33 ms budget. On larger
    // targets keep native output until a run of GPU-bound frames needs relief.
    constexpr double ReferencePixels = 1280.0 * 800;
    const double Pixels = double(Size.X) * Size.Y;
    if (Pixels <= ReferencePixels || GIsHighResScreenshot || !Family->SupportsScreenPercentage()) return;

    // Primary dynamic resolution scales shading. On a Retina display TSR and the
    // following passes can exceed 30 ms even at the primary floor. Scale their
    // output only after sustained GPU pressure; the HUD is drawn at display size.
    const double GpuMs = FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles());
    if (GpuMs > 0)
    {
        GpuTotalMs += FMath::Min(GpuMs, 100.0);
        if (++GpuSamples == 45)
        {
            const double MeanMs = GpuTotalMs / GpuSamples;
            const float Floor = FMath::Sqrt(ReferencePixels / Pixels);
            static const auto* Budget = IConsoleManager::Get().FindTConsoleVariableDataFloat(TEXT("r.DynamicRes.FrameTimeBudget"));
            const double TargetMs = Budget ? FMath::Max(24.f,Budget->GetValueOnGameThread()) : 33.33;
            if (MeanMs > TargetMs * 1.06)
            {
                ReconstructionScale = FMath::Max<float>(Floor, ReconstructionScale * FMath::Sqrt(TargetMs / MeanMs));
            }
            else if (MeanMs < TargetMs * .82)
            {
                ReconstructionScale = FMath::Min(1.f, ReconstructionScale + .06f);
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
    const bool ShoreApproach=WaterView==TEXT("shore-approach");
    const bool Waterline = WaterView == TEXT("waterline");
    const bool Pirate=WaterView==TEXT("pirate");
    const bool MooredView=Pirate || WaterView==TEXT("ship-shadow");
    const bool Dolphin=WaterView==TEXT("dolphin"), Whale=WaterView==TEXT("whale");
    const bool Entry=WaterView==TEXT("entry"), Shark=WaterView==TEXT("shark");
    const float Now=GetWorld()->GetTimeSeconds();
    if (WaterViewStart<0)
    {
        AStaticMeshActor* Ship=MooredView ? NearestMooredShip(GetWorld(), Pirate ? TEXT("SailingPirate") : TEXT("SailingMerchant")) : nullptr;
        if (MooredView && !Ship)
        {
            UE_LOG(LogTemp, Warning, TEXT("The %s replay needs its moored ship in the level."), *WaterView);
            WaterView=TEXT("sail");
            return;
        }
        WaterViewStart=Now;
        if (WorldMenu) Player->ToggleWorld();
        else if (!Entry && WaterView!=TEXT("chase"))
        {
            WaterCamera=GetWorld()->SpawnActor<ACameraActor>();
            WaterCamera->GetCameraComponent()->bConstrainAspectRatio=false;
            WaterCamera->GetCameraComponent()->SetFieldOfView(63);
            FVector Start=Beach ? FVector(31000,4000,35) : FVector(0,0,35);
            FRotator Heading=FRotator::ZeroRotator;
            double SurgeCmS=(Beach || Shark || Dolphin || Whale) ? 0 : 450;
            double Throttle=.9;
            if (ShoreApproach)
            {
                Start={19600,-12200,12};
                SurgeCmS=600;
                Throttle=1;
            }
            if (Ship)
            {
                const FTransform Pose=Ship->GetActorTransform();
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
            Yacht->SetEngineRunning(!Beach && !MooredView && !Shark && !Dolphin && !Whale && !Waterline && WaterView!=TEXT("sail"));
            Yacht->SetThrottle(Yacht->ReadHelm().bEngineOn ? Throttle : 0);
            Player->SetViewTarget(WaterCamera.Get());
        }
    }
    const float Age=Now-WaterViewStart;
    if (Entry)
    {
        if (Age<2) return;
        if (Yacht->Explorer().Mode()==ESkipperMode::Helm)
        {
            Player->InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::T, IE_Pressed, 1.f));
            Player->InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::T, IE_Released, 0.f));
        }
        if (Yacht->Explorer().Mode()!=ESkipperMode::Swim) return;
        if (EntryTime<0) EntryTime=Now;
        if (Now-EntryTime<.23) return;
        if (CapturedFrames==0 && !WaterFrames.IsEmpty())
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
                    const FVector Fin=Animals[0]->GetComponentLocation()*.01;
                    Eye=Fin+(Fin-Center).GetSafeNormal2D()*4.5+FVector(0,0,1.1);
                    Aim=Fin+FVector(0,0,.22);
                }
            }
        }
        if (Dolphin || Whale)
        {
            const TSubclassOf<AActor> Species = Dolphin ? ASailingDolphinPod::StaticClass() : ASailingWhales::StaticClass();
            AActor* Group = UGameplayStatics::GetActorOfClass(GetWorld(),Species);
            if (!Group || Group->IsHidden()) return;
            TInlineComponentArray<UStaticMeshComponent*> Bodies(Group);
            const FName Name = Dolphin ? FName(TEXT("Dolphin1")) : FName(TEXT("SurfacingWhale"));
            const auto* Found = Bodies.FindByPredicate([&](const auto* Body){return Body->GetFName()==Name;});
            if (!Found || !(*Found)->IsVisible()) return;
            Aim = (*Found)->GetComponentLocation()*.01;
            const double Depth=Yacht->SurfaceHeightM(FVector2D(Aim))-Aim.Z;
            SubjectReady=Depth < (Dolphin ? .15 : .05);

            Eye=Aim+(*Found)->GetRightVector()*(Dolphin ? 4.2 : 23.)+
                (*Found)->GetForwardVector()*(Dolphin ? .9 : 8.)+FVector(0,0,Dolphin ? 3.2 : 4.);
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
        const FString File=FPaths::Combine(WaterFrames,FString::Printf(TEXT("%04d.png"),CapturedFrames));
        FScreenshotRequest::RequestScreenshot(File,WorldMenu,false,false,FIntRect(),WorldMenu);
    }
    if (++CapturedFrames==WaterFrameCount+4) FPlatformMisc::RequestExit(false,TEXT("Water capture complete"));
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
    if (FrameTimesMs.Num() < 600) return;

    FrameTimesMs.Sort();
    double TotalMs = 0;
    int32 SlowFrames = 0;
    for (double Ms : FrameTimesMs)
    {
        TotalMs += Ms;
        if (Ms > 1000.0 / 30.0) ++SlowFrames;
    }
    const int32 Count = FrameTimesMs.Num();
    const FString Result = FString::Printf(
        TEXT("width,height,frames,average_fps,p95_frame_ms,frames_over_33_33_ms\n%d,%d,%d,%.2f,%.2f,%d\n"),
        Size.X, Size.Y, Count, 1000.0 * Count / TotalMs, FrameTimesMs[FMath::CeilToInt(.95 * Count) - 1], SlowFrames);
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
    if (AStaticMeshActor* Merchant = NearestMooredShip(World, TEXT("SailingMerchant")))
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
