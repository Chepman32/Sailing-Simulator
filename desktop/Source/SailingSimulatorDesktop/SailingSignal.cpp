#include "SailingSignal.h"

#include "Camera/CameraComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

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
}

void ASailingSignal::Light(bool bGreen, FVector Forward)
{
    bGreenSignal = bGreen;
    Heading = Forward.GetSafeNormal2D();
    const FLinearColor Tint = bGreen ? FLinearColor(.06, 1, .18) : FLinearColor(1, .025, .012);
    UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(Emission, this);
    Material->SetVectorParameterValue(TEXT("Color"), Tint * 16000);
    Ember->SetMaterial(0, Material);
    Streak->SetMaterial(0, Material);
    Glow->SetLightColor(Tint);
    Tick(0);
    SetLifeSpan(19);
}

void ASailingSignal::Tick(float Dt)
{
    Super::Tick(Dt);
    Elapsed += Dt;
    const float Rise = FMath::Min(Elapsed / 2.8f, 1.f);
    const float Fall = FMath::Max(Elapsed - 2.8f, 0.f);
    const FVector Side = FVector::CrossProduct(FVector::UpVector, Heading);
    const FVector Tip = Heading * (420 * Rise + 27 * Fall) + Side * (610 * Rise + 45 * Fall) +
                        FVector::UpVector * (6600 * Rise * (2 - Rise) - 245 * Fall);
    Ember->SetRelativeLocation(Tip);
    const float Flicker = .9f + .1f * FMath::Sin(Elapsed * 33);
    Ember->SetRelativeScale3D(FVector(.39f * Flicker));
    Glow->SetIntensity(65000 * Flicker * FMath::Clamp(19 - Elapsed, 0.f, 1.f));
    Streak->SetVisibility(Rise < 1);
    if (Rise < 1)
    {
        const float Length = FMath::Lerp(240.f, 25.f, Rise);
        Streak->SetRelativeLocation(Tip - FVector::UpVector * Length * .5);
        Streak->SetRelativeScale3D({.15, .15, Length / 100});
    }
    Canopy->SetVisibility(Rise >= 1);
    Canopy->SetRelativeLocation(Tip + FVector::UpVector * 125);
    const FVector CameraOffset = Side * 6800 - Heading * 2200 + FVector::UpVector * (1100 + Tip.Z * .25);
    Camera->SetRelativeLocationAndRotation(CameraOffset, (Tip * .68 - CameraOffset).Rotation());
}
