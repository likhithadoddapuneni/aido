import { View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Backdrop,
  Banner,
  Card,
  IconTile,
  RoomScene,
  Screen,
  Text,
  useTheme,
  type IconName,
} from '@aidooi/ui-native';
import { SectionTitle } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { useAppState } from '../../providers/AppProviders.tsx';
import { PATH_IDS, type PathId } from '../../projects/wizard.ts';

const ROOMS: readonly PathId[] = ['livingRoom', 'bedroom', 'diningRoom', 'homeOffice'];
const MORE: readonly { id: PathId; icon: IconName }[] = [
  { id: 'studio', icon: 'sofa' },
  { id: 'fullApartment', icon: 'home' },
  { id: 'villa', icon: 'pin' },
  { id: 'individualProduct', icon: 'sparkle' },
];

/** The one entry question: what are you furnishing? The answer routes to a wizard that asks only what it needs. */
export function HomeScreen() {
  const t = useTx();
  const router = useRouter();
  const { isGuest } = useAppState();
  const { space, color, radius } = useTheme();
  const width = useWindowDimensions().width;
  const gutter = space[3];
  const tile = (width - gutter * 2 - space[2]) / 2;
  const go = (id: PathId) => router.push(`/project/new/${id}` as never);
  return (
    <Screen padded={false} contentStyle={{ paddingBottom: space[5] }}>
      <View
        style={{
          overflow: 'hidden',
          borderBottomLeftRadius: radius.xl,
          borderBottomRightRadius: radius.xl,
        }}
      >
        <Backdrop variant="room" />
        <View style={{ padding: gutter, gap: space[1], paddingBottom: space[2] }}>
          <Text variant="label" tone="secondary" style={{ letterSpacing: 2 }}>
            AiDOOi
          </Text>
          <Text variant="hero" tone="navy" accessibilityRole="header">
            {t('home.title')}
          </Text>
          <Text tone="secondary">{t('home.subtitle')}</Text>
        </View>
        <RoomScene bare kind="livingRoom" width={width} height={Math.round((width * 5) / 8)} />
      </View>
      <View style={{ paddingHorizontal: gutter, gap: space[3] }}>
        {isGuest ? (
          <Banner
            tone="info"
            message={t('home.guest')}
            action={{ label: t('signIn.title'), onPress: () => router.push('/sign-in' as never) }}
          />
        ) : null}
        <SectionTitle>{t('home.sectionRooms')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {ROOMS.map((id) => (
            <Card
              key={id}
              flush
              onPress={() => go(id)}
              accessibilityLabel={`${t(`path.${id}.title` as never)}, ${t(`path.${id}.desc` as never)}`}
              style={{ width: tile }}
            >
              <View style={{ backgroundColor: color.linen }}>
                <RoomScene kind={id} width={tile} height={Math.round(tile * 0.64)} />
              </View>
              <View style={{ padding: space[3], gap: space[1] }}>
                <Text variant="h3">{t(`path.${id}.title` as never)}</Text>
                <Text variant="caption" tone="secondary" numberOfLines={3}>
                  {t(`path.${id}.desc` as never)}
                </Text>
              </View>
            </Card>
          ))}
        </View>
        <SectionTitle>{t('home.sectionMore')}</SectionTitle>
        <View style={{ gap: space[2] }}>
          {MORE.filter((m) => PATH_IDS.includes(m.id)).map(({ id, icon }) => (
            <Card
              key={id}
              onPress={() => go(id)}
              accessibilityLabel={`${t(`path.${id}.title` as never)}, ${t(`path.${id}.desc` as never)}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}
            >
              <IconTile name={icon} />
              <View style={{ flex: 1, gap: space[1] }}>
                <Text variant="body" style={{ fontWeight: '600' }}>
                  {t(`path.${id}.title` as never)}
                </Text>
                <Text variant="caption" tone="secondary">
                  {t(`path.${id}.desc` as never)}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      </View>
    </Screen>
  );
}
