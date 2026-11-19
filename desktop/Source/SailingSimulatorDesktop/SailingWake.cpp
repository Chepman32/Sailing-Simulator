#include "SailingWake.h"

#include "Kismet/GameplayStatics.h"
#include "ProceduralMeshComponent.h"
#include "SailingTrial.h"

ASailingWake::ASailingWake()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PostPhysics;
    Foam = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("WakeFoam"));
    SetRootComponent(Foam);
    Foam->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Foam->SetCastShadow(false);
    Foam->SetTranslucentSortPriority(1);
}

void ASailingWake::BeginPlay()
{
    Super::BeginPlay();
    TArray<int32> Indices;
    constexpr int32 StripSize = Across * (MaxRows + 1);
    for (int32 Strip = 0; Strip < Strips; ++Strip)
    {
        for (int32 Row = 0; Row < MaxRows; ++Row)
        {
            for (int32 I = 0; I < Across - 1; ++I)
            {
                const int32 A = Strip * StripSize + Row * Across + I;
                Indices.Append({ A, A + 1, A + Across, A + 1, A + Across + 1, A + Across });
            }
        }
    }
    Vertices.Init(FVector::ZeroVector, Strips * StripSize);
    UVs.Init(FVector2D::ZeroVector, Vertices.Num());
    Colors.Init(FLinearColor::Transparent, Vertices.Num());
    Trail.Reserve(MaxRows);
    Foam->SetMaterial(0, FoamMaterial);
    Foam->CreateMeshSection_LinearColor(0, Vertices, Indices, {}, UVs, Colors, {}, false);
}

void ASailingWake::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    const ASailingYachtPawn* Yacht = Cast<ASailingYachtPawn>(UGameplayStatics::GetPlayerPawn(this, 0));
    if (!Yacht || !FoamMaterial) return;

    const Sailing::FSeaFrame Sea = Yacht->SeaFrame();
    const FTransform YachtPose = Yacht->GetActorTransform();
    const FVector2D Beam(Yacht->GetActorRightVector().GetSafeNormal2D());
    const auto Position = [&YachtPose](double X, double Y)
    {
        return FVector2D(YachtPose.TransformPositionNoScale(FVector(X, Y, -28))) * 0.01;
    };
    const FVector2D Center = Position(-430, 0);
    const float Speed = Yacht->GetVelocity().Size2D() * 0.01;
    const Sailing::FHelm& Helm = Yacht->ReadHelm();
    const float Wash = Helm.bEngineOn ? FMath::Abs(Helm.Throttle) : 0.0f;
    while (!Trail.IsEmpty() && Sea.TimeS - Trail.Last().TimeS > 22.0f)
    {
        Trail.Pop(EAllowShrinking::No);
    }
    const float Distance = Trail.IsEmpty() ? 0.0f : FVector2D::Distance(Trail[0].Propeller, Center);
    const float Arc = Trail.IsEmpty() ? 0.0f : Trail[0].DistanceM + Distance;
    const FSample Head{ Position(-475, -193), Position(-475, 193), Center,
        Position(382, -193), Position(382, 193), Beam, Sea.TimeS, Arc, Speed, Wash };
    if (Trail.IsEmpty() || Distance >= 0.49f || (Sea.TimeS - Trail[0].TimeS > 0.18f && Wash > 0.06f))
    {
        if (Trail.Num() == MaxRows) Trail.Pop(EAllowShrinking::No);
        Trail.Insert(Head, 0);
    }

    for (int32 Strip = 0; Strip < Strips; ++Strip)
    {
        for (int32 Row = 0; Row <= MaxRows; ++Row)
        {
            const FSample& Sample = Row == 0 ? Head : Trail[FMath::Min(Row - 1, Trail.Num() - 1)];
            const double Age = FMath::Max(0.0f, Sea.TimeS - Sample.TimeS);
            const bool bPropeller = Strip == 2;
            const bool bBow = Strip >= 3;
            const bool bPort = Strip == 0 || Strip == 3;
            const double Travel = Age * Sample.Speed;
            const double Divergence = bBow ? Travel * .19 : .30 * FMath::Sin(Sample.DistanceM * .42 + Age * .36);
            const double HalfWidth = bPropeller ? .48 + .34 * Age :
                (bBow ? .34 + Travel * .055 : .86 + .50 * FMath::Sqrt(Travel));
            const FVector2D HullPosition = bBow ? (bPort ? Sample.BowPort : Sample.BowStarboard)
                : (bPort ? Sample.Port : Sample.Starboard);
            const FVector2D Mid = bPropeller ? Sample.Propeller : HullPosition + Sample.Beam * Divergence * (bPort ? -1 : 1);
            const float Strength = bPropeller ? Sample.Wash * FMath::Exp(-Age * 0.52) :
                FMath::SmoothStep(0.24f, bBow ? 3.6f : 2.8f, Sample.Speed) * FMath::Exp(-Age * (bBow ? .39f : .145f));
            for (int32 I = 0; I < Across; ++I)
            {
                const int32 Index = (Strip * (MaxRows + 1) + Row) * Across + I;
                const double U = static_cast<double>(I) / (Across - 1);
                const FVector2D XY = Mid + Sample.Beam * (2 * U - 1) * HalfWidth;
                const double Height = Sailing::SampleSea(XY, Sea.TimeS, 0, Sea.Scale).HeightM;
                Vertices[Index] = FVector(XY.X, XY.Y, Height + .045 + (bBow ? .085 * FMath::Exp(-Age * 1.9) : .012)) * 100.0;
                UVs[Index] = { U, Sample.DistanceM + 0.28 * Age + Strip * 23.0 };
                Colors[Index] = FLinearColor(FMath::Min(Age * .115, 1.0), bPropeller ? 1.0 : 0.0,
                    bBow ? 1.0 : 0.0, Row <= Trail.Num() ? Strength : 0.0f);
            }
        }
    }
    Foam->UpdateMeshSection_LinearColor(0, Vertices, {}, UVs, Colors, {}, false);
}
