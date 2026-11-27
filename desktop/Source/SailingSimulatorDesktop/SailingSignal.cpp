#include "SailingSignal.h"

#include "Camera/CameraComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"
#include "SailingPlayerController.h"
#include "SailingTrial.h"
#include "SailingVoyageSound.h"

ASailingSignal::ASailingSignal()
{
    PrimaryActorTick.bCanEverTick = true;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("SignalOrigin")));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Ball(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    static ConstructorHelpers::FObjectFinder<UMaterialInterface> GlowMaterial(
        TEXT("/Engine/EngineMaterials/EmissiveMeshMaterial.EmissiveMeshMaterial"));
    static ConstructorHelpers::FObjectFinder<UMaterialInterface> Cloth(
        TEXT("/Game/Materials/M_TrialFabric.M_TrialFabric"));
    Emission = GlowMaterial.Object;
    const auto Part = [&](FName Name) {
        auto* PartMesh = CreateDefaultSubobject<UStaticMeshComponent>(Name);
        PartMesh->SetupAttachment(GetRootComponent());
        PartMesh->SetStaticMesh(Ball.Object);
        PartMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        PartMesh->SetCastShadow(false);
        return PartMesh;
    };
    Ember = Part(TEXT("Flare"));
    Streak = Part(TEXT("LuminousTrail"));
    Canopy = Part(TEXT("Parachute"));
    Canopy->SetMaterial(0, Cloth.Object);
    Canopy->SetRelativeScale3D({1.4, 1.4, .47});
    Canopy->SetVisibility(false);
    Glow = CreateDefaultSubobject<UPointLightComponent>(TEXT("SignalLight"));
    Glow->SetupAttachment(Ember);
    Glow->SetCastShadows(false);
    Glow->SetAttenuationRadius(10500);
    Glow->SetSourceRadius(19);
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("SignalCamera"));
    Camera->SetupAttachment(GetRootComponent());
    Camera->SetFieldOfView(66);
    Camera->PostProcessSettings.bOverride_MotionBlurAmount = true;
    Camera->PostProcessSettings.MotionBlurAmount = .08f;
}

void ASailingSignal::Light(bool bGreen, ASailingYachtPawn& Yacht)
{
    bGreenSignal = bGreen;
    LaunchYacht = &Yacht;
    const FLinearColor Tint = bGreen ? FLinearColor(.06, 1, .18) : FLinearColor(1, .025, .012);
    UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(Emission, this);
    Material->SetVectorParameterValue(TEXT("Color"), Tint * 16000);
    Ember->SetMaterial(0, Material);
    Streak->SetMaterial(0, Material);
    Glow->SetLightColor(Tint);
    Tick(0);
    SetLifeSpan(19.f + LaunchLeadSeconds);
}

void ASailingSignal::Tick(float Dt)
{
    Super::Tick(Dt);
    const bool bWasFramingLaunch = Elapsed < LaunchLeadSeconds;
    Elapsed += Dt;
    const bool bIgnited = Elapsed >= LaunchLeadSeconds;
    if (bWasFramingLaunch && bIgnited) Elapsed = LaunchLeadSeconds;
    if (bWasFramingLaunch)
    {
        if (auto* Yacht = LaunchYacht.Get())
        {
            SetActorLocation(Yacht->GetActorTransform().TransformPosition({-380, 165, 291}));
            Heading = Yacht->GetActorForwardVector().GetSafeNormal2D();
            if (bIgnited)
                if (auto* Player = Cast<ASailingPlayerController>(Yacht->GetController())) Player->Sound().Cue(ESailingCue::Flare);
        }
    }
    const float Flight = Age();
    const float Rise = FMath::Min(Flight / 2.8f, 1.f);
    const float Fall = FMath::Max(Flight - 2.8f, 0.f);
    const FVector Side = FVector::CrossProduct(FVector::UpVector, Heading);
    const FVector Tip = Heading * (420 * Rise + 27 * Fall) + Side * (610 * Rise + 45 * Fall) +
                        FVector::UpVector * (6600 * Rise * (2 - Rise) - 245 * Fall);
    Ember->SetRelativeLocation(Tip);
    Ember->SetVisibility(bIgnited);
    const float Flicker = .9f + .1f * FMath::Sin(Flight * 33);
    Ember->SetRelativeScale3D(FVector(.39f * Flicker));
    Glow->SetIntensity(bIgnited ? 65000 * Flicker * FMath::Clamp(19 - Flight, 0.f, 1.f) : 0.f);
    Streak->SetVisibility(bIgnited && Rise > 0 && Rise < 1);
    if (bIgnited && Rise < 1)
    {
        const FVector Axis = (Heading * 420 + Side * 610 + FVector::UpVector * (13200 * (1 - Rise))).GetSafeNormal();
        const double Length = FMath::Min(Tip.Size(), double(FMath::Lerp(240.f, 25.f, Rise)));
        Streak->SetRelativeLocationAndRotation(Tip - Axis * Length * .5, FRotationMatrix::MakeFromZ(Axis).Rotator());
        Streak->SetRelativeScale3D({.15, .15, Length / 100});
    }
    Canopy->SetVisibility(Rise >= 1);
    Canopy->SetRelativeLocation(Tip + FVector::UpVector * 125);
    const double Pullback = FMath::SmoothStep(0., .46, double(Rise));
    const FVector CameraOffset = Side * FMath::Lerp(1260., 6800., Pullback) - Heading * FMath::Lerp(320., 2200., Pullback) +
        FVector::UpVector * (FMath::Lerp(340., 1100., Pullback) + Tip.Z * .25);
    const FVector TowardYacht = (Heading * 140. - CameraOffset).GetSafeNormal();
    const FVector TowardFlare = (Tip - CameraOffset).GetSafeNormal();
    const double Focus = FMath::Lerp(.50, .80, FMath::SmoothStep(.16, .82, double(Rise)));
    Camera->SetRelativeLocationAndRotation(CameraOffset, FMath::Lerp(TowardYacht, TowardFlare, Focus).Rotation());
}
