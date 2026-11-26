#include "SailingPlayerController.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "SailingTrial.h"

#include "Components/PrimitiveComponent.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/HUDHitBox.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputKeyEventArgs.h"
#include "Misc/AutomationTest.h"
#include "Slate/SceneViewport.h"
#include "SailingVoyageSound.h"
#include "Widgets/SViewport.h"
#include "Widgets/SWindow.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingWindowInputTest, "Sailing.Controls.WindowInput",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingWindowInputTest::RunTest(const FString&)
{
    if (FParse::Param(FCommandLine::Get(), TEXT("RenderOffscreen")))
    {
        AddInfo(TEXT("Native window activation and hit testing require a visible game window."));
        return true;
    }
    UGameViewportClient* Client = GEngine->GameViewport;
    auto* Player = Client ? Cast<ASailingPlayerController>(Client->GetWorld()->GetFirstPlayerController()) : nullptr;
    auto* HUD = Player ? Cast<ASailingTrialHUD>(Player->GetHUD()) : nullptr;
    if (!TestNotNull(TEXT("The sailing window has a helm"), HUD)) return false;
    auto View = Client->GetGameViewportWidget();
    auto Window = Client->GetWindow();
    if (!TestTrue(TEXT("The player viewport is attached to a window"), View.IsValid() && Window.IsValid())) return false;
    auto& Slate = FSlateApplication::Get();
    if (FParse::Param(FCommandLine::Get(), TEXT("SailingInteractivePreview")) && !FApp::IsUnattended())
        TestTrue(TEXT("The npm preview receives OS input and foreground audio"), Slate.IsActive() && Window->IsActive() && FApp::GetVolumeMultiplier() > 0.f);
    const bool Before = Player->Sound().Enabled();
    const auto Tap = [&](FKey Which) {
        const FKeyEvent Key(Which, {}, 0, false, 0, 0);
        Slate.ProcessKeyDownEvent(Key);
        Slate.ProcessKeyUpEvent(Key);
    };
    // No preparatory click or explicit focus. Enter through the focused Slate window.
    Tap(EKeys::M);
    TestTrue(TEXT("The first M in the game window reaches the sound control"), Player->Sound().Enabled() != Before);
    const auto ClickTopButton = [&](FName Name) {
        const FHUDHitBox* Button = HUD->GetHitBoxWithName(Name);
        if (!TestNotNull(*Name.ToString(), Button)) return false;
        const FVector2D Pixels(Client->GetGameViewport()->GetSizeXY());
        FVector2D ButtonPx(0, 34 * HUD->InputScale());
        while (ButtonPx.X < Pixels.X && !Button->Contains(ButtonPx)) ButtonPx.X += 4 * HUD->InputScale();
        if (!TestTrue(TEXT("Button is within the top row"), ButtonPx.X < Pixels.X)) return false;
        ButtonPx.X += 5 * HUD->InputScale();
        const FGeometry& Geometry = View->GetCachedGeometry();
        const FVector2D Point = Geometry.LocalToAbsolute(ButtonPx * FVector2D(Geometry.GetLocalSize()) / Pixels);
        const auto Path = Slate.LocateWindowUnderMouse(Point, {Window.ToSharedRef()});
        if (!TestTrue(TEXT("The window hit grid routes the button to the game viewport"), Path.ContainsWidget(View.Get()))) return false;
        const TSet<FKey> Down{EKeys::LeftMouseButton};
        Slate.RoutePointerDownEvent(Path, FPointerEvent(0, Point, Point, Down, EKeys::LeftMouseButton, 0, {}));
        Slate.RoutePointerUpEvent(Path, FPointerEvent(0, Point, Point, {}, EKeys::LeftMouseButton, 0, {}));
        return true;
    };
    const bool BeforeClick = Player->Sound().Enabled();
    if (!ClickTopButton(TEXT("Sound"))) return false;
    TestTrue(TEXT("Sound button toggles the mixer"), Player->Sound().Enabled() != BeforeClick);
    if (Player->Sound().Enabled() != Before) Tap(EKeys::M);
    if (!ClickTopButton(TEXT("World"))) return false;
    TestTrue(TEXT("The World button opens settings"), Player->GetPanel()==ESailingPanel::World);
    Tap(EKeys::Escape);
    TestTrue(TEXT("Escape closes the focused settings panel"), Player->GetPanel()==ESailingPanel::None);
    Tap(EKeys::Q);
    TestTrue(TEXT("The chart shortcut reaches the helm after closing settings"), Player->GetPanel()==ESailingPanel::Chart);
    Tap(EKeys::Escape);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingControlsTest, "Sailing.Controls.WebHelmAndViews",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingControlsTest::RunTest(const FString& Parameters)
{
    UGameViewportClient* Client = GEngine->GameViewport;
    ASailingPlayerController* Player = Client ? Cast<ASailingPlayerController>(Client->GetWorld()->GetFirstPlayerController()) : nullptr;
    ASailingYachtPawn* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!TestNotNull(TEXT("Local sailing player"), Yacht)) return false;
    FSceneViewport* Scene = Client->GetGameViewport();
    if (!TestNotNull(TEXT("Player viewport"), Scene)) return false;
    const auto Input = [Player](FKey Key, EInputEvent Event, float Value = 1.f)
    {
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(Key, Event, Value));
    };
    const auto Tap = [&Input](FKey Key) { Input(Key, IE_Pressed); Input(Key, IE_Released, 0); };
    const auto Hold = [&](FKey Key)
    {
        Input(Key, IE_Pressed);
        Player->PlayerTick(.1f);
        Input(Key, IE_Released, 0);
    };

    Yacht->SetEngineRunning(false);
    Yacht->SetThrottle(0);
    Hold(EKeys::Up);
    TestTrue(TEXT("Forward arrow starts the engine"), Yacht->ReadHelm().bEngineOn);
    TestEqual(TEXT("Throttle starts at slow ahead and ramps"), Yacht->ReadHelm().Throttle, .245, .001);
    const double Lever = Yacht->ReadHelm().Throttle;
    Input(EKeys::SpaceBar, IE_Pressed);
    Input(EKeys::SpaceBar, IE_Repeat);
    Input(EKeys::SpaceBar, IE_Released, 0);
    TestFalse(TEXT("Holding Space toggles only once"), Yacht->ReadHelm().bEngineOn);
    TestEqual(TEXT("Stopping preserves the lever position"), Yacht->ReadHelm().Throttle, Lever);
    Tap(EKeys::SpaceBar);
    TestEqual(TEXT("Restarting keeps the selected power"), Yacht->ReadHelm().Throttle, Lever);

    for (FKey Key : {EKeys::Right, EKeys::D, EKeys::Left, EKeys::A})
    {
        Hold(Key);
        const double Sign = Key == EKeys::Right || Key == EKeys::D ? 1.0 : -1.0;
        TestEqual(TEXT("Held helm turns progressively in the correct direction"), Yacht->ReadHelm().Rudder, Sign * .65, .001);
        Player->PlayerTick(.1f);
        TestEqual(TEXT("Released keyboard helm returns amidships"), Yacht->ReadHelm().Rudder, 0.0);
    }
    Hold(EKeys::Z);
    const double Eased = Yacht->ReadHelm().SheetEase;
    Hold(EKeys::X);
    TestTrue(TEXT("X sheets in after Z eased"), Yacht->ReadHelm().SheetEase < Eased);
    Tap(EKeys::Y);
    TestTrue(TEXT("Automatic trim can be restored"), Yacht->ReadHelm().bAutoTrim);
    Tap(EKeys::H);
    Tap(EKeys::SpaceBar);
    TestTrue(TEXT("Help consumes the engine key"), Yacht->ReadHelm().bEngineOn);
    Tap(EKeys::Escape);
    Tap(EKeys::Escape);
    TestTrue(TEXT("Escape pauses sailing"), Player->IsPaused());
    Tap(EKeys::Escape);
    TestFalse(TEXT("Escape resumes sailing"), Player->IsPaused());
    for (const TCHAR* Expected : {TEXT("Helm"), TEXT("Orbit"), TEXT("Drone"), TEXT("Chase")})
    {
        Tap(EKeys::V);
        TestEqual(TEXT("V cycles web views in order"), FString(Yacht->ViewName()), FString(Expected));
    }

    // Send viewport-local pointer events through Slate, without moving the OS cursor.
    const FIntPoint Size = Scene->GetSizeXY();
    const ASailingTrialHUD* HUD = Cast<ASailingTrialHUD>(Player->GetHUD());
    if (!TestNotNull(TEXT("Helm instruments"), HUD)) return false;
    const double Scale = HUD->InputScale();
    const FGeometry Geometry = FGeometry::MakeRoot(FVector2D(Size), FSlateLayoutTransform());
    const TSet<FKey> Buttons{EKeys::LeftMouseButton};
    const auto Pointer = [&](EInputEvent Event, FVector2D Position, float Wheel = 0.f)
    {
        const FPointerEvent Mouse(0, Position, Position, Buttons, EKeys::LeftMouseButton, Wheel, FModifierKeysState());
        if (Event == IE_Pressed) Scene->OnMouseButtonDown(Geometry, Mouse);
        else if (Event == IE_Released) Scene->OnMouseButtonUp(Geometry, Mouse);
        else if (Wheel != 0) Scene->OnMouseWheel(Geometry, Mouse);
        else Scene->OnMouseMove(Geometry, Mouse);
    };
    TestNull(TEXT("The HUD has no rudder panel"), HUD->GetHitBoxWithName(TEXT("Rudder")));
    Yacht->SetRudder(.4);
    Tap(EKeys::C);
    TestEqual(TEXT("C still centers the helm"), Yacht->ReadHelm().Rudder, 0.0);
    const double Axis = Size.X-89*Scale;
    const FVector2D LeverPoint(Axis, Size.Y*.60);
    const FVector2D EnginePoint(Axis, Size.Y-52*Scale);
    const auto ClickEngine = [&] {
        Pointer(IE_Pressed, EnginePoint);
        Pointer(IE_Released, EnginePoint);
    };
    Yacht->SetEngineRunning(false);
    Scene->Draw(false);
    TestNull(TEXT("The stopped engine hides the throttle hit target"), HUD->GetHitBoxWithName(TEXT("Throttle")));
    Pointer(IE_Pressed, LeverPoint);
    Pointer(IE_Released, LeverPoint);
    TestFalse(TEXT("Clicking the hidden lever area leaves the engine stopped"), Yacht->ReadHelm().bEngineOn);
    TestEqual(TEXT("The hidden lever keeps its setting"), Yacht->ReadHelm().Throttle, Lever);
    ClickEngine();
    TestTrue(TEXT("The engine switch remains clickable with the throttle hidden"), Yacht->ReadHelm().bEngineOn);
    TestEqual(TEXT("Starting restores the selected power"), Yacht->ReadHelm().Throttle, Lever);

    Scene->Draw(false);
    if (!TestNotNull(TEXT("Starting the engine shows the throttle"), HUD->GetHitBoxWithName(TEXT("Throttle")))) return false;
    Pointer(IE_Pressed, LeverPoint);
    Pointer(IE_Released, {Axis, Size.Y+10.});
    TestEqual(TEXT("A captured release below the window reaches full astern"), Yacht->ReadHelm().Throttle, -1.0);
    Pointer(IE_Pressed, LeverPoint);
    Pointer(IE_Released, {Axis, -10});
    TestEqual(TEXT("A captured release outside the window reaches full ahead"), Yacht->ReadHelm().Throttle, 1.0);
    Pointer(IE_Pressed, LeverPoint);
    const double LeverBeforeStop = Yacht->ReadHelm().Throttle;
    Tap(EKeys::SpaceBar);
    Pointer(IE_Released, {Axis, -10});
    TestEqual(TEXT("Switching off cancels an in-progress throttle drag"), Yacht->ReadHelm().Throttle, LeverBeforeStop);
    Scene->Draw(false);
    TestNull(TEXT("The throttle hit target disappears again after stopping"), HUD->GetHitBoxWithName(TEXT("Throttle")));
    ClickEngine();

    FVector2D SoundButton(0,34*Scale);
    const FHUDHitBox* SoundHitBox=HUD->GetHitBoxWithName(TEXT("Sound"));
    if (!TestNotNull(TEXT("Sound button has a hit target"),SoundHitBox)) return false;
    while (SoundButton.X<Size.X && !SoundHitBox->Contains(SoundButton)) SoundButton.X+=4*Scale;
    if (!TestTrue(TEXT("Sound button is reachable in the top row"),SoundButton.X<Size.X)) return false;
    const bool SoundWasEnabled = Player->Sound().Enabled();
    const auto ClickSound = [&] {
        Pointer(IE_Pressed, SoundButton);
        Pointer(IE_Released, SoundButton);
    };
    ClickSound();
    TestTrue(TEXT("Clicking the sound button changes the master setting"), Player->Sound().Enabled() != SoundWasEnabled);
    ClickSound();
    TestEqual(TEXT("Clicking the sound button again restores the master setting"), Player->Sound().Enabled(), SoundWasEnabled);

    USpringArmComponent* Arm = Yacht->FindComponentByClass<USpringArmComponent>();
    if (!TestNotNull(TEXT("Exterior camera arm"), Arm)) return false;
    const FVector2D Middle(Size.X * .5, Size.Y * .5);
    const FVector2D DragEnd = Middle + FVector2D(60, 35) * Scale;
    Pointer(IE_Pressed, Middle);
    Pointer(IE_Released, DragEnd);
    Yacht->Tick(.016f);
    TestTrue(TEXT("Dragging the scene orbits the yacht"), FMath::Abs(FMath::FindDeltaAngleDegrees(
        Arm->GetComponentRotation().Yaw, Yacht->GetActorRotation().Yaw)) > 12);
    for (int32 I = 0; I < 2; ++I)
    {
        Pointer(IE_Pressed, DragEnd);
        Pointer(IE_Released, DragEnd);
    }
    Yacht->Tick(.016f);
    TestTrue(TEXT("Double-click recenters the view"), FMath::Abs(FMath::FindDeltaAngleDegrees(
        Arm->GetComponentRotation().Yaw, Yacht->GetActorRotation().Yaw)) < 1);
    const float Distance = Arm->TargetArmLength;
    Pointer(IE_Axis, Middle, 1);
    Yacht->Tick(.1f);
    TestTrue(TEXT("Scroll up moves the camera closer"), Arm->TargetArmLength < Distance);

    Tap(EKeys::P);
    Yacht->Tick(1.f);
    const float CinemaYaw = Arm->GetComponentRotation().Yaw;
    const float CinemaDistance = Arm->TargetArmLength;
    Pointer(IE_Pressed, Middle);
    Pointer(IE_Released, DragEnd);
    Pointer(IE_Axis, Middle, 1);
    Yacht->Tick(.1f);
    TestTrue(TEXT("Dragging frames the cinematic shot"), Yacht->IsCinematic() && FMath::Abs(
        FMath::FindDeltaAngleDegrees(CinemaYaw, Arm->GetComponentRotation().Yaw)) > 12);
    TestTrue(TEXT("Scrolling zooms the cinematic shot"), Arm->TargetArmLength < CinemaDistance);
    Pointer(IE_Pressed, Middle);
    Pointer(IE_Released, Middle);
    TestFalse(TEXT("Clicking the picture leaves the cinematic view"), Yacht->IsCinematic());
    Tap(EKeys::P);
    Tap(EKeys::Tab);
    TestFalse(TEXT("Tab returns to the controls from the cinematic view"), Yacht->IsCinematic());

    Input(EKeys::W, IE_Pressed);
    Player->PlayerTick(.1f);
    Player->FlushPressedKeys();
    const double FocusLever = Yacht->ReadHelm().Throttle;
    Player->PlayerTick(.1f);
    TestEqual(TEXT("Losing focus releases held controls"), Yacht->ReadHelm().Throttle, FocusLever);
    return true;
}

namespace
{
class FWatchHelmTurn : public IAutomationLatentCommand
{
public:
    FWatchHelmTurn(FAutomationTestBase& InTest, ASailingPlayerController& InPlayer, ASailingYachtPawn& InYacht)
        : Test(InTest), Player(&InPlayer), Yacht(&InYacht), Original(InYacht.GetActorTransform()),
          Helm(InYacht.ReadHelm()), Velocity(Body().GetPhysicsLinearVelocity()),
          Spin(Body().GetPhysicsAngularVelocityInRadians())
    {
        StartTurn();
    }

    bool Update() override
    {
        if (!Player.IsValid() || !Yacht.IsValid()) return true;
        if (Yacht->GetWorld()->GetTimeSeconds() - Start < 3.) return false;

        const double Turn = FMath::FindDeltaAngleDegrees(Heading, Yacht->GetActorRotation().Yaw);
        Test.AddInfo(FString::Printf(TEXT("%s: %.1f degrees in 3 s"), bUnderPower ? TEXT("Slow ahead") : TEXT("Under sail"), Turn));
        Test.TestTrue(bUnderPower ? TEXT("The helm has authority at slow ahead") : TEXT("The helm has authority under sail"),
            Turn > (bUnderPower ? 5.8 : 13.));
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::D, IE_Released, 0.f));
        if (!bUnderPower)
        {
            bUnderPower = true;
            StartTurn();
            return false;
        }

        Yacht->SetActorTransform(Original, false, nullptr, ETeleportType::TeleportPhysics);
        Body().SetPhysicsLinearVelocity(Velocity);
        Body().SetPhysicsAngularVelocityInRadians(Spin);
        Yacht->SetEngineRunning(Helm.bEngineOn);
        Yacht->SetThrottle(Helm.Throttle);
        Yacht->SetRudder(Helm.Rudder);
        return true;
    }

private:
    UPrimitiveComponent& Body() const { return *CastChecked<UPrimitiveComponent>(Yacht->GetRootComponent()); }

    void StartTurn()
    {
        const FVector2D Spot(-950., -900.);
        const FRotator Attitude(0., Heading, 0.);
        const auto Frame = Yacht->SeaFrame();
        const auto Sea = Sailing::SampleSea(Spot, Frame.TimeS, 0., Frame.Scale, Yacht->HasCoralCoast());
        Yacht->SetActorLocationAndRotation(FVector(Spot, Sea.HeightM) * 100., Attitude, false, nullptr, ETeleportType::TeleportPhysics);
        Body().SetPhysicsLinearVelocity(Attitude.Vector() * (bUnderPower ? 160. : 450.) + FVector(0., 0., Sea.VelocityMps.Z * 100.));
        Body().SetPhysicsAngularVelocityInRadians(FVector::ZeroVector);
        Yacht->SetEngineRunning(bUnderPower);
        Yacht->SetThrottle(bUnderPower ? .28 : 0.);
        Yacht->SetRudder(0.);
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::D, IE_Pressed, 1.f));
        Start = Yacht->GetWorld()->GetTimeSeconds();
    }

    static constexpr double Heading = 25.;
    FAutomationTestBase& Test;
    TWeakObjectPtr<ASailingPlayerController> Player;
    TWeakObjectPtr<ASailingYachtPawn> Yacht;
    const FTransform Original;
    const Sailing::FHelm Helm;
    const FVector Velocity, Spin;
    double Start = 0.;
    bool bUnderPower = false;
};
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingHelmResponseTest, "Sailing.Controls.YachtHelmResponse",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingHelmResponseTest::RunTest(const FString&)
{
    UGameViewportClient* Client = GEngine->GameViewport;
    auto* Player = Client ? Cast<ASailingPlayerController>(Client->GetWorld()->GetFirstPlayerController()) : nullptr;
    auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!TestNotNull(TEXT("Local sailing player"), Yacht)) return false;
    ADD_LATENT_AUTOMATION_COMMAND(FWatchHelmTurn(*this, *Player, *Yacht));
    return true;
}

#if PLATFORM_MAC
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingMacKeysTest, "Sailing.Controls.MacKeyboardLayout",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingMacKeysTest::RunTest(const FString&)
{
    UGameViewportClient* Client = GEngine->GameViewport;
    auto* Player = Client ? Cast<ASailingPlayerController>(Client->GetWorld()->GetFirstPlayerController()) : nullptr;
    if (!TestNotNull(TEXT("Local sailing player"), Player)) return false;
    const auto Viewport = Client->GetGameViewportWidget();
    if (!TestTrue(TEXT("A Slate game viewport is available"), Viewport.IsValid())) return false;
    FSlateApplication& Slate = FSlateApplication::Get();
    Player->ToggleWorld();
    Player->ToggleWorld();
    if (!TestTrue(TEXT("Closing World returns keyboard focus to the helm"), Slate.GetKeyboardFocusedWidget() == Viewport))
        return false;

    // macOS still supplies the physical code when the current layout has
    // no matching Latin key. Send those events through Slate's normal routing.
    constexpr int MKeyCode = 0x2e, DKeyCode = 0x02;
    constexpr uint32 SoftSign = 0x44c, Ve = 0x432;
    const bool SoundBefore = Player->Sound().Enabled();
    Slate.OnKeyDown(MKeyCode, SoftSign, false);
    Slate.OnKeyUp(MKeyCode, SoftSign, false);
    TestTrue(TEXT("The sound shortcut works in a Cyrillic layout"), Player->Sound().Enabled() != SoundBefore);
    Slate.OnKeyDown(MKeyCode, SoftSign, false);
    Slate.OnKeyUp(MKeyCode, SoftSign, false);

    ASailingYachtPawn* Yacht = Player->GetPawn<ASailingYachtPawn>();
    if (!TestNotNull(TEXT("Playable yacht"), Yacht)) return false;
    Slate.OnKeyDown(DKeyCode, Ve, false);
    Player->PlayerTick(.1f);
    TestTrue(TEXT("Held steering works in a Cyrillic layout"), Yacht->ReadHelm().Rudder > .1);
    Slate.OnKeyUp(DKeyCode, Ve, false);
    Player->PlayerTick(.1f);
    TestEqual(TEXT("Release clears the steering key"), Yacht->ReadHelm().Rudder, 0.);
    return true;
}
#endif
#endif
