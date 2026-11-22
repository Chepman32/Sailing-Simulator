#include "SailingWhales.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "SailingTrial.h"

ASailingWhales::ASailingWhales()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PostPhysics;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Whales")));
    Visitor = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("SurfacingWhale"));
    Breacher = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("DistantWhale"));
    for (UStaticMeshComponent* Body : {Visitor.Get(), Breacher.Get()})
    {
        Body->SetupAttachment(GetRootComponent());
        Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Body->SetVisibility(false);
    }
}

void ASailingWhales::BeginPlay()
{
    Super::BeginPlay();
    Visitor->SetStaticMesh(WhaleMesh);
    Breacher->SetStaticMesh(WhaleMesh);
    Near.Next = 2.;
    Far.Next = 28.;
}

bool ASailingWhales::FindPass(FPass& Pass, const ASailingYachtPawn& Yacht, bool bDistant) const
{
    const FVector Bow = Yacht.GetActorForwardVector().GetSafeNormal2D();
    const double Radius = bDistant ? 21000. : 9400.;
    const FCollisionQueryParams Query(SCENE_QUERY_STAT(WhalePass), true, &Yacht);
    // Check the entire passage, including the whale's beam and its dive depth.
    for (double Bearing : {-36., 24., -65., 65., 0., 110., -110., 180.})
    {
        const FVector Ray = Bow.RotateAngleAxis(Bearing, FVector::UpVector);
        const FVector Middle = Yacht.GetActorLocation() + Ray*Radius;
        const FVector Course = FVector::CrossProduct(FVector::UpVector,Ray);
        const FVector A = Middle-Course*3400, B = Middle+Course*3400;
        const FVector Depth(0,0,-580);
        if (GetWorld()->SweepTestByChannel(FVector(A.X,A.Y,0)+Depth,FVector(B.X,B.Y,0)+Depth,
            FQuat::Identity, ECC_Visibility, FCollisionShape::MakeBox(FVector(520,520,1100)),Query)) continue;
        Pass.Direction = Course;
        Pass.Start = A;
        Pass.Age = 0;
        Pass.bContact = false;
        return true;
    }
    return false;
}

void ASailingWhales::Swim(FPass& Pass, UStaticMeshComponent& Body, ASailingYachtPawn& Yacht, float Dt, bool bDistant)
{
    const double Now = GetWorld()->GetTimeSeconds();
    if (Pass.Age < 0)
    {
        if (Now < Pass.Next) return;
        Pass.Next = Now + 3.;
        if (!FindPass(Pass,Yacht,bDistant)) return;
        Body.SetVisibility(true);
    }
    Pass.Age += Dt;
    const double Duration = bDistant ? 14. : 19.;
    const double U = FMath::Min(1.,Pass.Age/Duration);
    FVector P = Pass.Start + Pass.Direction * (U*6800.);
    double Height, Pitch, Roll=0;
    if (bDistant)
    {
        const double T = Pass.Age - Duration*.5;
        Height = FMath::Max(-1250., 670.-245.*T*T);
        Pitch = FMath::Clamp(-22.*T,-40.,54.);
        Roll = 26.*FMath::Exp(-T*T*.25);
    }
    else
    {
        const double Rise = FMath::SmoothStep(0.,.29,U) * (1.-FMath::SmoothStep(.70,1.,U));
        Height = FMath::Lerp(-1100., 58.+15.*FMath::Sin(U*11), Rise);
        Pitch = 5.*FMath::Sin(U*UE_TWO_PI);
    }
    P.Z = Yacht.SurfaceHeightM(FVector2D(P)*.01)*100. + Height;
    Body.SetWorldLocationAndRotation(P,FRotator(Pitch,Pass.Direction.Rotation().Yaw,Roll));
    if (!Pass.bContact && (bDistant ? (U>.5 && Height<35) : Height>12))
    {
        Yacht.DisturbSurface(P, bDistant ? .85f : .20f);
        Pass.bContact = true;
    }
    if (U >= 1.)
    {
        Body.SetVisibility(false);
        Pass.Age = -1;
        Pass.Next = Now + (bDistant ? FMath::FRandRange(19.f,43.f) : FMath::FRandRange(29.f,44.f));
    }
}

void ASailingWhales::Tick(float Dt)
{
    Super::Tick(Dt);
    auto* Yacht = Cast<ASailingYachtPawn>(UGameplayStatics::GetPlayerPawn(this,0));
    if (!Yacht || !WhaleMesh) return;
    Swim(Near,*Visitor,*Yacht,Dt,false);
    Swim(Far,*Breacher,*Yacht,Dt,true);
}
