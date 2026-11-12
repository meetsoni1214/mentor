export type PersonalContext = readonly string[];

export interface ConversationProfileReader {
  read(ownerId: string): Promise<PersonalContext>;
}
