#include "SailingPhysics.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "SailingFoamField.h"
#include "SailingSpray.h"
#include <cmath>

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingBowSprayFlight, "Sailing.Sea.BowSprayFlight",
    EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)

bool FSailingBowSprayFlight::RunTest(const FString& Parameters)
{
    const auto Launch = [](float Gale, bool bMist)
    {
        FRandomStream Random(4387);
        Sailing::FSprayPuff Puff;
        Puff.LaunchFromBow(FVector::ZeroVector,FVector::RightVector,FVector::ForwardVector,
            FVector::ZeroVector,FVector(30,0,0),0.f,1.f,Gale,.75f,bMist,Random);
        return Puff;
    };
    const auto LastAloft = [](const Sailing::FSprayPuff& Puff)
    {
        float Last = 0.f;
        for (int32 I=1; I<60*Puff.Life; ++I)
        {
            const float Age = I/60.f;
            if (Puff.Opacity(Age/Puff.Life)>.15f && Puff.PositionM(Age).Z>0.) Last=Age;
        }
        return Last;
    };
    const float Storm = FMath::SmoothStep(2.f,Sailing::HurricaneSeaScale,Sailing::StormSeaScale);
    const auto Previous = Launch(0,true), Mist = Launch(Storm,true), Sheet = Launch(Storm,false);
    const float OldLast = LastAloft(Previous), NewLast = LastAloft(Mist);
    const FVector OldTravel = Previous.PositionM(OldLast)-Previous.OriginM;
    const FVector NewTravel = Mist.PositionM(NewLast)-Mist.OriginM;
    AddInfo(FString::Printf(TEXT("Strong impact, 30 m/s crosswind, previous/storm mist: aloft %.2f / %.2f s, outboard %.2f / %.2f m, horizontal travel %.2f / %.2f m"),
        OldLast,NewLast,OldTravel.Y,NewTravel.Y,OldTravel.Size2D(),NewTravel.Size2D()));
    TestTrue(TEXT("Mist stays aloft beyond the falling sheet"),NewLast>2.f && NewLast>2.*OldLast && LastAloft(Sheet)<NewLast);
    TestTrue(TEXT("The initial throw clears the hull across the wind"),NewTravel.Y>2.3*OldTravel.Y);
    TestTrue(TEXT("Detached droplets continue downwind"),NewTravel.X>2.*OldTravel.X && Mist.PositionM(2.).X>Mist.PositionM(1.).X);
    TestTrue(TEXT("Heavy water returns under gravity"),Sheet.PositionM(2.).Z<Sheet.OriginM.Z);
    TestTrue(TEXT("Visibility ramps up and expires"),Mist.Opacity(0.f)==0.f && Mist.Opacity(1.f)==0.f);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingShoalingTest, "Sailing.Sea.FiniteDepthBreakers",
    EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)

bool FSailingShoalingTest::RunTest(const FString& Parameters)
{
    const auto Profiles = Sailing::SurfProfileTexels();
    constexpr int32 Width = Sailing::SurfProfileWidth;
    constexpr double Omega = 1.16, Gravity = 9.81;
    TestTrue(TEXT("Every coast supplies a phase and derivative row"), Profiles.Num() >= 2*Width && Profiles.Num()%(2*Width)==0);
    double DispersionError=0, FluxError=0, PhaseError=0;
    for (int32 Row=0; Row<Profiles.Num(); Row+=2*Width)
    {
        const auto* Samples=Profiles.GetData()+Row;
        for (int32 I=0; I<Width; ++I)
        {
            const auto& P=Samples[I];
            const double K=P.A, KH=K*P.B;
            const double Cg=.5*Omega/K*(1+2*KH/std::sinh(2*KH));
            DispersionError=FMath::Max(DispersionError,FMath::Abs(Gravity*K*std::tanh(KH)-Omega*Omega));
            FluxError=FMath::Max(FluxError,FMath::Abs(Cg*P.G*P.G-.5*Gravity/Omega));
            if (I) PhaseError=FMath::Max(PhaseError,FMath::Abs(2.*(P.R-Samples[I-1].R)-.5*(K+Samples[I-1].A)));
        }
        TestTrue(TEXT("Crests slow and wavelengths shorten on approach"), Samples[16].A>2*Samples[Width-1].A);
        TestEqual(TEXT("The swash is phase-locked at the waterline"),Samples[16].R,0.f);
    }
    TestTrue(TEXT("All shore profiles solve finite-depth dispersion"),DispersionError<2e-6);
    TestTrue(TEXT("Incoming wave energy flux is conserved up to breaking"),FluxError<2e-5);
    TestTrue(TEXT("Spacing between crests follows the integrated wavenumber"),PhaseError<.025);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingSurfaceTest, "Sailing.Sea.SurfaceDerivatives",
    EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)

bool FSailingSurfaceTest::RunTest(const FString& Parameters)
{
    const FVector2D Position(12.31, -8.70);
    constexpr double Time = 28.3;
    constexpr double Step = 0.0001;
    const Sailing::FSeaSample Water = Sailing::SampleSea(Position, Time);
    const double Dx = (Sailing::SampleSea(Position + FVector2D(Step, 0), Time).HeightM
        - Sailing::SampleSea(Position - FVector2D(Step, 0), Time).HeightM) / (2.0 * Step);
    const double Dt = (Sailing::SampleSea(Position, Time + Step).HeightM
        - Sailing::SampleSea(Position, Time - Step).HeightM) / (2.0 * Step);
    TestEqual(TEXT("Normal uses the slope of the rendered height function"), Water.Gradient.X, Dx, 1e-6);
    TestEqual(TEXT("Surface rise matches vertical water velocity"), Water.VelocityMps.Z, Dt, 1e-6);
    TestTrue(TEXT("Wind chop motion fades at depth"),
        Sailing::SampleSea(Position, Time, 200.0).VelocityMps.Size() < 1e-6);

    const Sailing::FSeaFrame Storm{ 76.25f, Sailing::HurricaneSeaScale };
    const FVector2D AlongRoute(382.13, -90.24);
    double PackedHeight = 0, PackedCompression = 0;
    double LongSwellEnergy = 0, TotalEnergy = 0;
    double ShortWaveEnergy = 0, DownwindEnergy = 0, GaleWindSeaEnergy = 0;
    FVector2D PackedGradient = FVector2D::ZeroVector;
    for (int32 I = 0; I < Sailing::SeaWaveCount; ++I)
    {
        const FLinearColor Mode = Sailing::SeaWaveParameter(I, Storm);
        const FVector2D WaveNumber(Mode.R, Mode.G);
        const double Wavelength=UE_DOUBLE_TWO_PI/WaveNumber.Size();
        TotalEnergy+=FMath::Square(Mode.B);
        if (Wavelength>70.0) LongSwellEnergy+=FMath::Square(Mode.B);
        if (Wavelength<10.0)
        {
            TestTrue(TEXT("Short chop grows by less than 20 percent in a hurricane"),
                Mode.B<=1.20*Sailing::SeaWaveAmplitude(I,1.0));
            const double SlopeEnergy=FMath::Square(WaveNumber.Size()*Sailing::SeaWaveAmplitude(I,1.0));
            ShortWaveEnergy+=SlopeEnergy;
            DownwindEnergy+=SlopeEnergy*FVector2D::DotProduct(WaveNumber.GetSafeNormal(),
                FVector2D(Sailing::TrueWind(0,1)).GetSafeNormal());
        }
        if (Wavelength>10 && Wavelength<25 && Sailing::SeaWaveAmplitude(I,1.0)==0)
            GaleWindSeaEnergy+=FMath::Square(Mode.B*WaveNumber.Size());
        const double Phase = FVector2D::DotProduct(WaveNumber, AlongRoute) + Mode.A;
        const double Crest = FMath::Cos(Phase);
        PackedHeight += Mode.B * (Crest + Sailing::SeaCrestShape * (Crest * Crest - 0.5));
        PackedCompression += Mode.B * WaveNumber.Size() * Crest;
        PackedGradient -= WaveNumber * Mode.B * FMath::Sin(Phase) * (1.0 + 2.0 * Sailing::SeaCrestShape * Crest);
    }
    const Sailing::FSeaSample StormSurface = Sailing::SampleSea(AlongRoute, Storm.TimeS, 0, Storm.Scale);
    TestEqual(TEXT("Packed GPU spectrum preserves storm draft"), PackedHeight, StormSurface.HeightM, 1e-5);
    TestTrue(TEXT("Packed GPU spectrum preserves storm slope"), PackedGradient.Equals(StormSurface.Gradient, 1e-5));
    TestEqual(TEXT("The rendered whitecaps and airborne spray use the same crest compression"),
              PackedCompression, StormSurface.Compression, 1e-5);
    TestTrue(TEXT("Long swell carries most of the hurricane energy"), LongSwellEnergy>.75*TotalEnergy);
    TestTrue(TEXT("Short-crested trade-wind seas travel downwind across the swell"),
        ShortWaveEnergy>0 && DownwindEnergy>.85*ShortWaveEnergy);
    TestTrue(TEXT("A gale develops breaking-scale wind seas over the long swell"), GaleWindSeaEnergy>.03);
    const double HurricaneHeight=Sailing::SignificantWaveHeight(Storm.Scale);
    TestTrue(TEXT("Light air in the calm preset"),Sailing::TrueWind(0,.16).Size()<2.);
    TestTrue(TEXT("Open-water hurricane drives the rig above 33 m/s"),Sailing::TrueWind(0,Storm.Scale).Size()>33.);
    const auto Reefed = Sailing::SolveSail(FVector::ForwardVector,{0,34,0},{});
    TestTrue(TEXT("Less than a quarter of the working sail remains in hurricane winds"),
             Reefed.WorkingAreaFraction>.1 && Reefed.WorkingAreaFraction<.25);
    float Developing = .16f;
    for (int32 I=0; I<60*90; ++I)
    {
        const float Prior = Developing;
        Developing = Sailing::AdvanceSeaScale(Prior,Sailing::HurricaneSeaScale,1.f/60);
        const double AddedHeight = Sailing::SignificantWaveHeight(Developing)-Sailing::SignificantWaveHeight(Prior);
        if (AddedHeight<0 || AddedHeight>.010)
        {
            AddError(TEXT("Switching directly from calm to hurricane raised the wave field too fast"));
            return false;
        }
    }
    TestEqual(TEXT("A sustained gale raises the full hurricane sea"),Developing,Sailing::HurricaneSeaScale,.001f);
    TestTrue(TEXT("A clearing sky leaves residual swell"),Sailing::AdvanceSeaScale(Developing,.16f,1)>4.3f);
    TestTrue(TEXT("Hurricane has significant wave heights of eight to ten metres"), HurricaneHeight>=8.0 && HurricaneHeight<=10.0);

    const FVector2D Shoal(281.0, -120.8);
    const auto Breaker = Sailing::SampleSea(Shoal, Time, 0, 1.65, true);
    const auto Height = [&](FVector2D P, double T) { return Sailing::SampleSea(P, T, 0, 1.65, true).HeightM; };
    TestTrue(TEXT("The cay transforms the arriving swell"), FMath::Abs(Breaker.HeightM -
        Sailing::SampleSea(Shoal, Time, 0, 1.65).HeightM) > .035);
    for (const FVector2D Direction : {FVector2D(1,0), FVector2D(0,1)})
        TestEqual(TEXT("Breaking wave normal follows the coastline and run-up envelope"),
            FVector2D::DotProduct(Breaker.Gradient, Direction),
            (Height(Shoal+Direction*Step,Time)-Height(Shoal-Direction*Step,Time))/(2*Step), 2e-6);
    TestEqual(TEXT("The swimmer and hull feel the vertical speed of the breaker"), Breaker.VelocityMps.Z,
              (Height(Shoal,Time+Step)-Height(Shoal,Time-Step))/(2*Step), 2e-6);
    TestEqual(TEXT("Height-only wave contacts follow the same surface"),
              Sailing::SeaHeight(Shoal, {float(Time),1.65f}, true), Breaker.HeightM, 2e-6);
    for (int32 I=0; I<24; ++I)
    {
        const auto Land = Sailing::SampleSea({344,79},Time+I*.25,0,2.4,true);
        TestTrue(TEXT("Offshore swell cannot reappear beyond the swash on dry sand"),
            Land.HeightM==0 && Land.Gradient.IsZero() && Land.VelocityMps.IsZero());
    }

    const Sailing::FBoatWake Wake{{0,0}, {1,0}, 4.6};
    const FVector2D Crest(-8, 1.92+.285*16);
    TestTrue(TEXT("Powered hulls displace a measurable crest astern"), Wake.HeightAt(Crest) > .15);
    TestEqual(TEXT("Both hulls displace the water"), Wake.HeightAt(Crest), Wake.HeightAt({Crest.X,-Crest.Y}), 1e-8);
    TestEqual(TEXT("No bow wave on a stopped boat"), Sailing::FBoatWake{{0,0},{1,0},0}.HeightAt(Crest), 0.0);
    TestEqual(TEXT("Wake dies away offshore"), Wake.HeightAt({-70,22}), 0.0);
    Sailing::FWakeHistory History;
    History.Record(Wake,0);
    const FVector2D Wing(.34*4.6*3.,1.93+.335*.66*4.6*3.);
    const auto Packet=History.At(Wing,3);
    TestTrue(TEXT("Each transom sheds a crest into the surrounding sea"),Packet.HeightM>.065);
    TestEqual(TEXT("Port and starboard shed equal crests on a straight course"), Packet.HeightM,History.At({Wing.X,-Wing.Y},3).HeightM,1e-7);
    for (FVector2D Dir : {FVector2D(1,0),FVector2D(0,1)})
        TestEqual(TEXT("Shed wake slope follows its surface"),FVector2D::DotProduct(Dir,Packet.Gradient),
            (History.At(Wing+Dir*Step,3).HeightM-History.At(Wing-Dir*Step,3).HeightM)/(2*Step),2e-6);
    TestEqual(TEXT("Shed wake velocity follows the traveling packet"),Packet.VelocityMps.Z,
        (History.At(Wing,3+Step).HeightM-History.At(Wing,3-Step).HeightM)/(2*Step),2e-6);
    History.Record({{4,0},{0,1},0},3);
    TestEqual(TEXT("The old heading and energy survive a stop and turn"),History.At(Wing,3).HeightM,Packet.HeightM);
    TestEqual(TEXT("Old packets disperse"),History.At(Wing,12).HeightM,0.);
    const auto Turning = Sailing::FBoatWake::FromMotion({4.7,0},{1,0},{4.6,0},.32);
    const auto Opposite = Sailing::FBoatWake::FromMotion({4.7,0},{1,0},{4.6,0},-.32);
    TestTrue(TEXT("The outer hull displaces a larger attached crest"),Turning.HeightAt({Crest.X,-Crest.Y})>1.3*Turning.HeightAt(Crest));
    TestEqual(TEXT("Reversing the turn mirrors the waves"),Turning.HeightAt(Crest),Opposite.HeightAt({Crest.X,-Crest.Y}),1e-7);
    Sailing::FWakeHistory TurnTrail;
    TurnTrail.Record(Turning,0);
    TurnTrail.Record({{4,0},{0,1},0},2);
    const auto Inner = TurnTrail.At(Wing,3);
    TestTrue(TEXT("The shed crests keep each hull's energy after stopping"),TurnTrail.At({Wing.X,-Wing.Y},3).HeightM>1.3*Inner.HeightM);
    TestEqual(TEXT("Unequal wave powers preserve the local water slope"),Inner.Gradient.Y,
        (TurnTrail.At(Wing+FVector2D(0,Step),3).HeightM-TurnTrail.At(Wing-FVector2D(0,Step),3).HeightM)/(2*Step),2e-6);
    Sailing::FWaterImpacts Impacts;
    Impacts.Emit({16., -4.}, 15.f, .32f);
    const FVector2D RingPoint(18.35,-4);
    const auto Ring = Impacts.At(RingPoint,16);
    TestTrue(TEXT("An impact propagates away from the original point of contact"), Ring.HeightM > .15);
    TestEqual(TEXT("Ring velocity matches the changing surface"), Ring.VelocityMps.Z,
        (Impacts.At(RingPoint,16+Step).HeightM-Impacts.At(RingPoint,16-Step).HeightM)/(2*Step),2e-6);
    TestEqual(TEXT("A spent impact releases its water"), Impacts.At(RingPoint,22).HeightM, 0.);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingFoamTest,"Sailing.Sea.TwinFoam",
    EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)

bool FSailingFoamTest::RunTest(const FString& Parameters)
{
    const auto Sail=[](int32 Hz,float Thrust)
    {
        Sailing::FFoamField Field;
        for (int32 Frame=0; Frame<=16*Hz; ++Frame)
        {
            const float T=float(Frame)/Hz;
            Field.Record({{4*T,0},{1,0},4,4,Thrust},T);
        }
        return Field;
    };
    auto Field=Sail(30,0);
    TArray<FColor> Pixels,Reference;
    Field.Rasterize(Pixels);
    Sail(60,0).Rasterize(Reference);
    TestTrue(TEXT("Wake coverage is independent of render frame rate at 30 and 60 Hz"),Pixels==Reference);
    const auto At=[&](double X,double Y)
    {
        return Pixels[Sailing::FFoamField::Texel(FMath::FloorToInt(X/Sailing::FFoamField::CellM),
                                                  FMath::FloorToInt(Y/Sailing::FFoamField::CellM))];
    };
    TestTrue(TEXT("Both hull lanes remain visible under sail"),At(57,-2).R>100 && At(57,2).R>100);
    TestTrue(TEXT("There is clear water between the transoms under sail"),At(57,0).R<12 && At(57,0).B==0);
    TestTrue(TEXT("Dispersing hull bubbles meet farther down the wake under sail"),At(42,0).R>20 && At(42,0).B==0);
    Sail(30,1).Rasterize(Pixels);
    TestTrue(TEXT("Prop wash occupies its own channel only under power"),At(57,0).B>80);
    Field.Record({{64,0},{0,1},0,0,0},16.1f);
    Field.Rasterize(Pixels);
    TestTrue(TEXT("A turn cannot rotate the existing trail"),At(53,2).R>50);
    Field.Record({{64,0},{0,1},.02f,.02f,0},16.12f);
    const FVector2D Ahead=Field.Center();
    Field.Record({{64,0},{0,1},-.02f,-.02f,0},16.14f);
    TestTrue(TEXT("Drifting through neutral keeps the old foam in view"),
        FVector2D::Distance(Ahead,Field.Center()) < Sailing::FFoamField::CellM);
    Field.Record({{420,200},{1,0},0,0,0},16.2f);
    Field.Rasterize(Pixels);
    TestTrue(TEXT("Relocation does not connect distant wakes"),!Pixels.ContainsByPredicate(
        [](const FColor& C){ return C.R || C.G || C.B; }));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingForcesTest, "Sailing.Yacht.ForceDirections",
    EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)

bool FSailingForcesTest::RunTest(const FString& Parameters)
{
    Sailing::FHelm Helm;
    const FVector Forward = FVector::ForwardVector;
    const Sailing::FSail Port = Sailing::SolveSail(Forward, {-6.0, 6.0, 0.0}, Helm);
    const Sailing::FSail Starboard = Sailing::SolveSail(Forward, {-6.0, -6.0, 0.0}, Helm);
    TestTrue(TEXT("A close reach drives forward"), Port.ForceN.X > 0.0);
    TestEqual(TEXT("Drive matches on mirrored tacks"), Port.ForceN.X, Starboard.ForceN.X, 1e-6);
    TestEqual(TEXT("Side force mirrors across the centerline"), Port.ForceN.Y, -Starboard.ForceN.Y, 1e-6);
    TestTrue(TEXT("Head to wind has no positive drive"),
        Sailing::SolveSail(Forward, {-8.0, 0.0, 0.0}, Helm).ForceN.X <= 0.0);
    Sailing::FHelm Astern = Helm;
    Astern.bEngineOn = true;
    Astern.Throttle = -1.;
    TestTrue(TEXT("Automatic trim spills sail drive when manoeuvring astern in a crosswind"),
        Sailing::SolveSail(Forward, {0., 9., 0.}, Astern).ForceN.X <
        Sailing::SolveSail(Forward, {0., 9., 0.}, Helm).ForceN.X * .15);

    constexpr double Time = 7.0;
    Sailing::FRigidState Hull = { {10, 4, 3}, {10, 4, 3}, FQuat::Identity, {5, 0, 0}, FVector::ZeroVector };
    TestEqual(TEXT("Dry pontoons exert zero buoyancy"), Sailing::CalculateLoads(Hull, Helm, Time).ForceN.Z, 0.0, 1e-6);
    Hull.OriginM.Z = Hull.CenterOfMassM.Z = 0.0;
    const double NeutralAhead = Sailing::CalculateLoads(Hull, Helm, Time).TorqueNm.Z;
    Helm.Rudder = 1.0;
    TestTrue(TEXT("Starboard helm yaws to starboard under forward flow"),
        Sailing::CalculateLoads(Hull, Helm, Time).TorqueNm.Z > NeutralAhead);
    Hull.VelocityMps.X = -5.0;
    const double SteeredAstern = Sailing::CalculateLoads(Hull, Helm, Time).TorqueNm.Z;
    Helm.Rudder = 0.0;
    TestTrue(TEXT("Rudder response reverses under backward flow"),
        SteeredAstern < Sailing::CalculateLoads(Hull, Helm, Time).TorqueNm.Z);
    // Settle the actual longitudinal force balance in still water.
    Helm.bEngineOn = true;
    Helm.Throttle = 1.;
    Hull.VelocityMps = FVector::ZeroVector;
    for (int Step=0; Step<120*60; ++Step)
        Hull.VelocityMps.X += Sailing::CalculateLoads(Hull,Helm,0.,0.).ForceN.X/(Sailing::MassKg*60);
    AddInfo(FString::Printf(TEXT("Full ahead in still water: %.2f kn"), Hull.VelocityMps.X*Sailing::KnotsPerMps));
    TestEqual(TEXT("Full-ahead cruising speed increases by half"),Hull.VelocityMps.X,5.28*1.5,.15);
    Hull = {FVector::ZeroVector,{0,0,-.30},FQuat::Identity,FVector::ZeroVector,FVector::ZeroVector};
    Helm = {};
    TestEqual(TEXT("Loaded displacement supports the authored waterline"),
        Sailing::CalculateLoads(Hull,Helm,0.,0.).ForceN.Z,Sailing::MassKg*9.81,.01);
    Hull.OriginM.Z = -2.;
    Hull.CenterOfMassM.Z = -2.30;
    Hull.VelocityMps.Z = -14.;
    TestTrue(TEXT("Re-entry has a finite upward load even at high impact speed"),
        Sailing::CalculateLoads(Hull,Helm,0.,0.).ForceN.Z <= 2.15*Sailing::MassKg*9.81+.01);
    Hull.Rotation = FQuat(FVector::ForwardVector,UE_DOUBLE_PI);
    Hull.CenterOfMassM = Hull.OriginM + Hull.Rotation.RotateVector({0,0,-.30});
    Hull.VelocityMps = FVector::ZeroVector;
    TestTrue(TEXT("A motionless and fully inverted boat still has a righting moment"),
        Sailing::CalculateLoads(Hull,Helm,0.,0.).TorqueNm.Size2D() > Sailing::MassKg*9.81);
    return true;
}
#endif
