#include "SailingPlayerController.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "SailingTrial.h"

#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputKeyEventArgs.h"
#include "Misc/AutomationTest.h"
#include "Slate/SceneViewport.h"

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
    TestEqual(TEXT("Throttle starts at slow ahead and ramps"), Yacht->ReadHelm().Throttle, .175, .001);
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
        TestEqual(TEXT("Held helm turns progressively in the correct direction"), Yacht->ReadHelm().Rudder, Sign * .24, .001);
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
    const FVector2D Wheel(53 * Scale, Size.Y - 52 * Scale);
    Pointer(IE_Pressed, Wheel);
    Pointer(IE_Released, Wheel + FVector2D(55 * Scale, 0));
    Player->PlayerTick(.1f);
    TestEqual(TEXT("Dragging the wheel holds the rudder on release"), Yacht->ReadHelm().Rudder, .5, .02);
    Tap(EKeys::C);
    TestEqual(TEXT("C centers the wheel"), Yacht->ReadHelm().Rudder, 0.0);
    Pointer(IE_Pressed, {Size.X - 100 * Scale, Size.Y - 145 * Scale});
    Pointer(IE_Released, {Size.X - 100 * Scale, Size.Y - 79 * Scale});
    TestEqual(TEXT("The mouse lever reaches full astern"), Yacht->ReadHelm().Throttle, -1.0, .04);

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
#endif
