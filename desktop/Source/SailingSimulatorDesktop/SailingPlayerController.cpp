#include "SailingPlayerController.h"

#include "SailingExplorer.h"
#include "SailingSignal.h"
#include "SailingVoyageSound.h"
#include "GameFramework/HUDHitBox.h"
#include "InputKeyEventArgs.h"
#include "Kismet/GameplayStatics.h"
#include "SailingTrial.h"
#include "SailingWeather.h"

ASailingPlayerController::ASailingPlayerController()
{
    bShowMouseCursor = true;
    VoyageSound = CreateDefaultSubobject<USailingVoyageSound>(TEXT("VoyageAudio"));
}

void ASailingPlayerController::BeginPlay()
{
    Super::BeginPlay();
    if (!IsLocalController()) return;
    UpdatePointerMode();
    Weather = Cast<ASailingWeather>(UGameplayStatics::GetActorOfClass(this, ASailingWeather::StaticClass()));
}

void ASailingPlayerController::UpdatePointerMode()
{
    ASailingYachtPawn* Yacht = GetPawn<ASailingYachtPawn>();
    const bool bLook = Yacht && Yacht->Explorer().Away() && Panel == ESailingPanel::None;
    bShowMouseCursor = !bLook;
    if (bLook)
    {
        FInputModeGameOnly Mode;
        Mode.SetConsumeCaptureMouseDown(false);
        SetInputMode(Mode);
    }
    else
    {
        FInputModeGameAndUI Mode;
        Mode.SetHideCursorDuringCapture(false);
        SetInputMode(Mode);
    }
}

void ASailingPlayerController::Notice(FString Message)
{
    RecentNotice = MoveTemp(Message);
    NoticeUntil = FPlatformTime::Seconds() + 2.8;
}

FString ASailingPlayerController::NoticeText() const
{
    return FPlatformTime::Seconds() < NoticeUntil ? RecentNotice : FString();
}

void ASailingPlayerController::EndSignalView(ASailingYachtPawn& Yacht)
{
    if (!SignalShot.IsValid()) return;
    SignalShot.Reset();
    SetViewTargetWithBlend(&Yacht, .25f);
}

void ASailingPlayerController::Signal(ASailingYachtPawn& Yacht, FKey Key)
{
    if (Key == EKeys::J || Key == EKeys::B)
    {
        const bool bHorn = Key == EKeys::J;
        VoyageSound->Cue(bHorn ? ESailingCue::Horn : ESailingCue::Bell);
        FString Label = bHorn ? TEXT("Horn") : TEXT("Bell");
        if (!VoyageSound->Enabled()) Label += TEXT(" · M for sound");
        Notice(MoveTemp(Label));
        return;
    }
    const float Now = GetWorld()->GetTimeSeconds();
    if (Now - LastFlareTime < 1.4f) return;
    Flares.RemoveAll([](const TWeakObjectPtr<ASailingSignal>& Flare) { return !Flare.IsValid(); });
    if (Flares.Num() >= 3)
    {
        Flares[0]->Destroy();
        Flares.RemoveAt(0);
    }
    const FVector Origin = Yacht.GetActorTransform().TransformPosition({-380, 165, 240});
    auto* Flare = GetWorld()->SpawnActor<ASailingSignal>(Origin, FRotator::ZeroRotator);
    if (!Flare) return;
    const bool bGreen = Key == EKeys::G;
    Flare->Light(bGreen, Yacht.GetActorForwardVector());
    Flares.Add(Flare);
    SignalShot = Flare;
    LastFlareTime = Now;
    SetViewTargetWithBlend(Flare, .38f);
    VoyageSound->Cue(ESailingCue::Flare);
    Notice(bGreen ? TEXT("Green flare") : TEXT("Red flare"));
}

void ASailingPlayerController::ToggleSkipper(ASailingYachtPawn& Yacht)
{
    EndSignalView(Yacht);
    Yacht.ToggleExplorer();
    FlushPressedKeys();
    UpdatePointerMode();
}

bool ASailingPlayerController::HasShortcutModifier() const
{
    return IsInputKeyDown(EKeys::LeftControl) || IsInputKeyDown(EKeys::RightControl) ||
           IsInputKeyDown(EKeys::LeftCommand) || IsInputKeyDown(EKeys::RightCommand) ||
           IsInputKeyDown(EKeys::LeftAlt) || IsInputKeyDown(EKeys::RightAlt);
}

void ASailingPlayerController::FlushPressedKeys()
{
    Super::FlushPressedKeys();
    bLeftShift = bRightShift = false;
    Drag = EDrag::None;
    bTapCandidate = false;
    LastTapTime = -1;
    if (auto* Yacht = GetPawn<ASailingYachtPawn>()) Yacht->Explorer().ClearInput();
}

void ASailingPlayerController::OpenPanel(ESailingPanel Next)
{
    if (Panel == ESailingPanel::Pause || Next == ESailingPanel::Pause)
    {
        if (!SetPause(Next == ESailingPanel::Pause)) return;
    }
    Panel = Next;
    if (auto* Yacht = GetPawn<ASailingYachtPawn>())
    {
        Yacht->Explorer().SetFrozen(Next != ESailingPanel::None);
        if (Next == ESailingPanel::Chart) Chart.Open(*GetWorld(), *Yacht);
    }
    if (Next != ESailingPanel::None && GetHUD()) GetHUD()->bShowHUD = true;
    FlushPressedKeys();
    UpdatePointerMode();
}

bool ASailingPlayerController::InputKey(const FInputKeyEventArgs& Params)
{
    const bool bHandled = Super::InputKey(Params);
    ASailingYachtPawn* Yacht = GetPawn<ASailingYachtPawn>();
    if (!Yacht || !IsLocalController()) return bHandled;

    const FKey Key = Params.Key;
    // A chord sees the modifier at the key event, even when its press or
    // release and O arrive between the same two player ticks.
    if (Key == EKeys::LeftShift || Key == EKeys::RightShift)
    {
        bool& Shift = Key == EKeys::LeftShift ? bLeftShift : bRightShift;
        if (Params.Event == IE_Pressed) Shift = true;
        else if (Params.Event == IE_Released) Shift = false;
        return bHandled;
    }
    USailingExplorer& Explorer = Yacht->Explorer();
    if (Explorer.Away() && Panel == ESailingPanel::None && Params.Event == IE_Axis &&
        (Key == EKeys::MouseX || Key == EKeys::MouseY))
    {
        Explorer.Look(Key == EKeys::MouseX ? Params.AmountDepressed : 0,
                      Key == EKeys::MouseY ? Params.AmountDepressed : 0);
        return true;
    }
    if (Key == EKeys::LeftMouseButton)
    {
        if (Explorer.Away() && Panel == ESailingPanel::None) return bHandled;
        FVector2D Position;
        if (!GetMousePosition(Position.X, Position.Y))
        {
            Drag = EDrag::None;
            LastTapTime = -1;
            return bHandled;
        }
        ASailingTrialHUD* HUD = Cast<ASailingTrialHUD>(GetHUD());
        if (Params.Event == IE_Released)
            ReleasePointer(Position, *Yacht, HUD);
        else if (Params.Event == IE_Pressed || Params.Event == IE_DoubleClick)
            PressPointer(Position, *Yacht, HUD);
        return true;
    }
    const bool bCrouchKey = Key == EKeys::LeftControl || Key == EKeys::RightControl;
    if (HasShortcutModifier() && !(Explorer.Away() && bCrouchKey)) return bHandled;
    if (Key == EKeys::MouseWheelAxis && Params.Event == IE_Axis)
    {
        if (Panel == ESailingPanel::Chart)
        {
            int32 Width, Height;
            GetViewportSize(Width, Height);
            FVector2D Mouse(Width * .5, Height * .5);
            GetMousePosition(Mouse.X, Mouse.Y);
            const ASailingTrialHUD* HUD = Cast<ASailingTrialHUD>(GetHUD());
            Chart.Zoom(Params.AmountDepressed,
                       (Mouse - FVector2D(Width * .5, Height * .5)) / (HUD ? HUD->InputScale() : 1));
        }
        else if (Panel == ESailingPanel::None && !Explorer.Away())
            Yacht->ZoomView(Params.AmountDepressed);
        return true;
    }
    if (Params.Event != IE_Pressed) return bHandled;
    if (Key == EKeys::Tab && Yacht->IsCinematic())
    {
        Yacht->SetCinematic(false);
        return true;
    }
    if (Key == EKeys::Escape)
    {
        if (Panel != ESailingPanel::None)
            OpenPanel(ESailingPanel::None);
        else if (Yacht->IsCinematic())
            Yacht->SetCinematic(false);
        else if (SignalShot.IsValid())
            EndSignalView(*Yacht);
        else
            OpenPanel(ESailingPanel::Pause);
        return true;
    }
    if (Key == EKeys::M)
    {
        VoyageSound->Toggle();
        Notice(VoyageSound->Enabled() ? TEXT("Sound on") : TEXT("Sound off"));
        return true;
    }
    if (Key == EKeys::H)
    {
        Yacht->SetCinematic(false);
        OpenPanel(Panel == ESailingPanel::Controls ? ESailingPanel::None : ESailingPanel::Controls);
        return true;
    }
    if (Key == EKeys::Q || Key == EKeys::N || Key == EKeys::Tab)
    {
        const ESailingPanel Target = Key == EKeys::Tab ? ESailingPanel::Gear : ESailingPanel::Chart;
        if (Panel != ESailingPanel::None && Panel != Target) return bHandled;
        EndSignalView(*Yacht);
        Yacht->SetCinematic(false);
        OpenPanel(Panel == Target ? ESailingPanel::None : Target);
        return true;
    }
    if (Panel == ESailingPanel::Chart && Key == EKeys::R)
    {
        Chart.Recenter(*Yacht);
        return true;
    }
    if (Key == EKeys::T && (Panel == ESailingPanel::None || Panel == ESailingPanel::Chart))
    {
        if (Panel == ESailingPanel::Chart) OpenPanel(ESailingPanel::None);
        ToggleSkipper(*Yacht);
        return true;
    }
    if (Panel != ESailingPanel::None) return bHandled;
    if (Explorer.Away())
    {
        if (Key == EKeys::SpaceBar)
            Explorer.Jump();
        else if (Key == EKeys::C || bCrouchKey)
            Explorer.Crouch();
        else if (Key == EKeys::F)
            Explorer.ToggleTorch();
        else if (Key == EKeys::E)
        {
            Explorer.Interact(*Yacht);
            if (!Explorer.Away())
            {
                FlushPressedKeys();
                UpdatePointerMode();
            }
        }
        else
            return bHandled;
        return true;
    }
    if (Key == EKeys::V || Key == EKeys::R || Key == EKeys::P) EndSignalView(*Yacht);
    if (Key == EKeys::J || Key == EKeys::B || Key == EKeys::F || Key == EKeys::G)
    {
        if (!Yacht->IsCinematic()) Signal(*Yacht, Key);
        return true;
    }
    if (Key == EKeys::O)
    {
        VoyageSound->Tune(bLeftShift || bRightShift ? -1 : 1);
        Notice(VoyageSound->StationLabel());
        return true;
    }
    if (Key == EKeys::V)
        Yacht->CycleView();
    else if (Key == EKeys::P)
        Yacht->SetCinematic(!Yacht->IsCinematic());
    else if (Key == EKeys::R)
        Yacht->RecenterView();
    else if (Key == EKeys::C)
        Yacht->SetRudder(0);
    else if (Key == EKeys::SpaceBar)
        Yacht->SetEngineRunning(!Yacht->ReadHelm().bEngineOn);
    else if (Key == EKeys::W || Key == EKeys::Up)
        Yacht->SetEngineRunning(true);
    else if (Key == EKeys::Y)
        Yacht->ResumeAutoTrim();
    else if (Weather && Key == EKeys::L)
        Weather->RequestLightning();
    else if (Weather && Key == EKeys::One)
        Weather->SelectCondition(0);
    else if (Weather && Key == EKeys::Two)
        Weather->SelectCondition(1);
    else if (Weather && Key == EKeys::Three)
        Weather->SelectCondition(2);
    else if (Weather && Key == EKeys::Four)
        Weather->SelectCondition(3);
    else
        return bHandled;
    return true;
}

void ASailingPlayerController::PostProcessInput(float DeltaTime, bool bGamePaused)
{
    Super::PostProcessInput(DeltaTime, bGamePaused);
    ASailingYachtPawn* Yacht = GetPawn<ASailingYachtPawn>();
    if (!Yacht || bGamePaused) return;
    USailingExplorer& Explorer = Yacht->Explorer();
    if (bLeaping && Explorer.Mode() == ESkipperMode::Swim) VoyageSound->Cue(ESailingCue::Splash);
    bLeaping = Explorer.Mode() == ESkipperMode::Leap;
    VoyageSound->Update(*Yacht);
    Chart.Track(Yacht->GetActorLocation());
    if (SignalShot.IsValid() && SignalShot->Age() > 5.5f) EndSignalView(*Yacht);
    if (Panel == ESailingPanel::Chart)
    {
        if (Chart.bFollowing) Chart.Recenter(*Yacht);
        FVector2D Mouse;
        if (Drag == EDrag::Chart && GetMousePosition(Mouse.X, Mouse.Y))
            MovePointer(Mouse, *Yacht, Cast<ASailingTrialHUD>(GetHUD()));
    }
    if (Panel != ESailingPanel::None || (!Explorer.Away() && HasShortcutModifier()))
    {
        Yacht->DriveHelm(DeltaTime, 0, 0, 0);
        return;
    }
    const int32 Steering = int32(IsInputKeyDown(EKeys::D) || IsInputKeyDown(EKeys::Right)) -
                           int32(IsInputKeyDown(EKeys::A) || IsInputKeyDown(EKeys::Left));
    const int32 Throttle = int32(IsInputKeyDown(EKeys::W) || IsInputKeyDown(EKeys::Up)) -
                           int32(IsInputKeyDown(EKeys::S) || IsInputKeyDown(EKeys::Down));
    if (Explorer.Away())
    {
        Explorer.SetMovement(
            FVector2D(Throttle, Steering), IsInputKeyDown(EKeys::LeftShift) || IsInputKeyDown(EKeys::RightShift),
            IsInputKeyDown(EKeys::SpaceBar),
            IsInputKeyDown(EKeys::C) || IsInputKeyDown(EKeys::LeftControl) || IsInputKeyDown(EKeys::RightControl));
        return;
    }
    const int32 Ease = int32(IsInputKeyDown(EKeys::Z)) - int32(IsInputKeyDown(EKeys::X));
    Yacht->DriveHelm(DeltaTime, Steering, Throttle, Ease);
    FVector2D Position;
    if (Drag != EDrag::None && GetMousePosition(Position.X, Position.Y))
    {
        MovePointer(Position, *Yacht, Cast<ASailingTrialHUD>(GetHUD()));
    }
}

void ASailingPlayerController::PressPointer(FVector2D Position, ASailingYachtPawn& Yacht, ASailingTrialHUD* HUD)
{
    Drag = EDrag::None;
    PressPosition = LastPosition = Position;
    const FHUDHitBox* Box =
        HUD && HUD->bShowHUD && !Yacht.IsCinematic() ? HUD->GetHitBoxAtCoordinates(Position) : nullptr;
    if (Box)
    {
        LastTapTime = -1;
        const FName Name = Box->GetName();
        if (Name == TEXT("Close"))
            OpenPanel(ESailingPanel::None);
        else if (Name == TEXT("Help"))
            OpenPanel(ESailingPanel::Controls);
        else if (Name == TEXT("Chart"))
            OpenPanel(ESailingPanel::Chart);
        else if (Name == TEXT("Follow"))
            Chart.Recenter(Yacht);
        else if (Name == TEXT("ZoomIn"))
            Chart.Zoom(1, FVector2D::ZeroVector);
        else if (Name == TEXT("ZoomOut"))
            Chart.Zoom(-1, FVector2D::ZeroVector);
        else if (Panel == ESailingPanel::None)
        {
            if (Name == TEXT("Engine"))
                Yacht.SetEngineRunning(!Yacht.ReadHelm().bEngineOn);
            else if (Name == TEXT("View"))
            {
                EndSignalView(Yacht);
                Yacht.CycleView();
            }
            else if (Name == TEXT("Overboard"))
                ToggleSkipper(Yacht);
            else if (Name == TEXT("Sound"))
            {
                VoyageSound->Toggle();
                Notice(VoyageSound->Enabled() ? TEXT("Sound on") : TEXT("Sound off"));
            }
            else if (Name == TEXT("Radio"))
            {
                VoyageSound->Tune(1);
                Notice(VoyageSound->StationLabel());
            }
            else if (Name == TEXT("Horn"))
                Signal(Yacht, EKeys::J);
            else if (Name == TEXT("Bell"))
                Signal(Yacht, EKeys::B);
            else if (Name == TEXT("Red"))
                Signal(Yacht, EKeys::F);
            else if (Name == TEXT("Green"))
                Signal(Yacht, EKeys::G);
            else if (Name == TEXT("Center"))
                Yacht.SetRudder(0);
            else if (Name == TEXT("Rudder"))
            {
                Drag = EDrag::Rudder;
                StartRudder = Yacht.ReadHelm().Rudder;
                Yacht.SetRudder(StartRudder);
            }
            else if (Name == TEXT("Throttle") && Yacht.ReadHelm().bEngineOn)
            {
                Drag = EDrag::Throttle;
                Yacht.SetThrottle(HUD->ThrottleAt(Position.Y));
            }
        }
        return;
    }
    if (Panel == ESailingPanel::Chart)
    {
        Drag = EDrag::Chart;
        return;
    }
    if (Panel != ESailingPanel::None) return;
    EndSignalView(Yacht);
    Drag = EDrag::View;
    PressTime = FPlatformTime::Seconds();
    bTapCandidate = true;
}

void ASailingPlayerController::MovePointer(FVector2D Position, ASailingYachtPawn& Yacht, const ASailingTrialHUD* HUD)
{
    const float Scale = HUD ? HUD->InputScale() : 1.f;
    if (Drag == EDrag::Chart)
        Chart.Pan((Position - LastPosition) / Scale);
    else if (Drag == EDrag::View)
    {
        const float DragThreshold = (Yacht.IsCinematic() ? 10.f : 8.f) * Scale;
        if (FVector2D::DistSquared(Position, PressPosition) > FMath::Square(DragThreshold))
        {
            bTapCandidate = false;
            LastTapTime = -1;
        }
        Yacht.OrbitView((Position - LastPosition) / Scale);
    }
    else if (Drag == EDrag::Rudder)
        Yacht.SetRudder(StartRudder + (Position.X - PressPosition.X) / (110.0 * Scale));
    else if (Drag == EDrag::Throttle && HUD && Yacht.ReadHelm().bEngineOn)
        Yacht.SetThrottle(HUD->ThrottleAt(Position.Y));
    LastPosition = Position;
}

void ASailingPlayerController::ReleasePointer(FVector2D Position, ASailingYachtPawn& Yacht, const ASailingTrialHUD* HUD)
{
    MovePointer(Position, Yacht, HUD);
    if (Drag == EDrag::View)
    {
        const double Now = FPlatformTime::Seconds();
        if (Yacht.IsCinematic())
        {
            if (bTapCandidate && Now - PressTime < .45) Yacht.SetCinematic(false);
            LastTapTime = -1;
        }
        else if (bTapCandidate && Now - PressTime <= .30)
        {
            const double TapRadius = 24.0 * (HUD ? HUD->InputScale() : 1.f);
            const bool bDoubleTap =
                Now - LastTapTime <= .35 && FVector2D::DistSquared(Position, LastTapPosition) <= TapRadius * TapRadius;
            if (bDoubleTap) Yacht.RecenterView();
            LastTapTime = bDoubleTap ? -1 : Now;
            LastTapPosition = Position;
        }
        else
            LastTapTime = -1;
    }
    Drag = EDrag::None;
}
